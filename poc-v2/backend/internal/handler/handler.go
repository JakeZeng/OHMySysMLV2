// Package handler 实现 HTTP handler（直接调用 repository，避免 service 层冗余）。
package handler

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/sysmlv2/mbse-backend/internal/hub"
	"github.com/sysmlv2/mbse-backend/internal/middleware"
	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/parser"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// Handler 持有 repository 引用，提供所有 HTTP 处理函数。
type Handler struct {
	repo *repository.SQLiteRepository
	hub  *hub.Hub
}

// New 构造 Handler。
//
// 接受可选 hub；nil 表示关闭 SSE 广播（向后兼容旧测试）。
func New(repo *repository.SQLiteRepository, h ...*hub.Hub) *Handler {
	out := &Handler{repo: repo}
	if len(h) > 0 && h[0] != nil {
		out.hub = h[0]
	}
	return out
}

// ─── Health ──────────────────────────────────────────────────────────

var startTime = time.Now()

// derefPackages 把 []*model.PackageSummary 解引用为 []model.PackageSummary。
// （handler 层常把 repo 返回的指针切片转值切片给 parser/工具函数。）
func derefPackages(pkgs []*model.PackageSummary) []model.PackageSummary {
	out := make([]model.PackageSummary, len(pkgs))
	for i, p := range pkgs {
		if p != nil {
			out[i] = *p
		}
	}
	return out
}

func (h *Handler) Health(c *gin.Context) {
	// M4.5 增量：附带 DB ping + 资源计数，便于运维探活与监控。
	// 失败时仍返回 200（健康探针不应被资源统计拖死），但 status 字段标 degraded。
	dbStatus := "ok"
	if err := h.repo.DB().PingContext(c); err != nil {
		dbStatus = "degraded: " + err.Error()
	}
	counts := h.repo.Counts(c)

	// M8: SLA 监控指标
	uptime := time.Since(startTime)
	uptimeStr := fmt.Sprintf("%dd %dh %dm",
		int(uptime.Hours()/24),
		int(uptime.Hours())%24,
		int(uptime.Minutes())%60,
	)

	// 简单的可用性计算（基于 DB 状态）
	availability := "99.9%"
	if dbStatus != "ok" {
		availability = "degraded"
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"status":       "ok",
		"db":           dbStatus,
		"time":         time.Now().UTC().Format(time.RFC3339),
		"counts":       counts,
		"uptime":       uptimeStr,
		"uptimeSeconds": int(uptime.Seconds()),
		"availability": availability,
		"version":      "1.0.0",
		"environment":  getEnv("GIN_MODE", "debug"),
	}})
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

// ─── Auth（极简版：仅 username + password，无 JWT） ─────────────────────

type registerReq struct {
	Username string `json:"username" binding:"required,min=3,max=50"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6,max=128"`
}

type loginReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type tokenResp struct {
	Token    string      `json:"token"`
	Expires  time.Time   `json:"expires"`
	User     *model.User `json:"user"`
}

// newToken 生成 JWT token（24 小时有效期）。
func newToken(userID string) (string, time.Time, error) {
	expires := time.Now().Add(24 * time.Hour)
	token, err := middleware.GenerateToken(userID, 24*time.Hour)
	if err != nil {
		return "", time.Time{}, err
	}
	return token, expires, nil
}

// Register 注册新用户。
func (h *Handler) Register(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	// 检查用户名/邮箱是否已存在
	if existing, _ := h.repo.GetUserByUsername(c, req.Username); existing != nil {
		badRequest(c, "用户名已存在", nil)
		return
	}
	if existing, _ := h.repo.GetUserByEmail(c, req.Email); existing != nil {
		badRequest(c, "邮箱已被注册", nil)
		return
	}

	user := &model.User{
		ID:           uuid.NewString(),
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: hashPassword(req.Password),
		CreatedAt:    time.Now().UTC(),
	}
	if err := h.repo.CreateUser(c, user); err != nil {
		serverError(c, "创建用户失败", err)
		return
	}

	// 在调用 writeAudit 前注入 user_id（注册时无 JWT，context user_id 为空）。
	// 这样注册日志 actor 与新用户一致，便于按用户聚合审计。
	c.Set("user_id", user.ID)
	writeAudit(c, h.repo, "register", "user", user.ID,
		`{"username":"`+escapeJSON(user.Username)+`","email":"`+escapeJSON(user.Email)+`"}`)

	token, expires, err := newToken(user.ID)
	if err != nil {
		serverError(c, "生成 token 失败", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": tokenResp{
		Token:   token,
		Expires: expires,
		User:    user,
	}})
}

// Login 登录。
func (h *Handler) Login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	user, err := h.repo.GetUserByUsername(c, req.Username)
	if err != nil {
		badRequest(c, "用户名或密码错误", nil)
		return
	}
	if !checkPassword(req.Password, user.PasswordHash) {
		// 登录失败也记录审计（IP + 尝试的用户名），用于异常检测。
		// actorID 用 user.ID 便于按用户聚合异常登录尝试。
		c.Set("user_id", user.ID)
		writeAudit(c, h.repo, "login_fail", "user", user.ID,
			`{"username":"`+escapeJSON(req.Username)+`"}`)
		badRequest(c, "用户名或密码错误", nil)
		return
	}

	// 登录成功：把 user_id 注入 context，让后续 writeAudit 记录 actor。
	c.Set("user_id", user.ID)
	writeAudit(c, h.repo, "login", "user", user.ID,
		`{"username":"`+escapeJSON(user.Username)+`"}`)

	token, expires, err := newToken(user.ID)
	if err != nil {
		serverError(c, "生成 token 失败", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": tokenResp{
		Token:   token,
		Expires: expires,
		User:    user,
	}})
}

// Me 返回当前登录用户的基本信息（含 isAdmin）— M4.5 增量。
//
// 用于前端 bootstrap 时确认 admin 权限（决定是否渲染"归档清理"等管理按钮）。
func (h *Handler) Me(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{
			"code": "E_UNAUTHORIZED", "message": "未登录",
		}})
		return
	}
	user, err := h.repo.GetUserByID(c, userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{
			"code": "E_UNAUTHORIZED", "message": "用户不存在",
		}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": user})
}

// ─── Projects ────────────────────────────────────────────────────────

type createProjectReq struct {
	Name        string `json:"name" binding:"required,min=1,max=100"`
	Description string `json:"description"`
	Visibility  string `json:"visibility"` // M4：private|team|public（创建时可设；默认 private）
}

func (h *Handler) ListProjects(c *gin.Context) {
	userID := c.GetString("user_id")
	projects, err := h.repo.ListAccessibleProjects(c, userID)
	if err != nil {
		serverError(c, "列出项目失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": projects})
}

func (h *Handler) CreateProject(c *gin.Context) {
	userID := c.GetString("user_id")
	var req createProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	// visibility 校验：只接受合法枚举；非法值返回 400
	visibility := model.VisibilityPrivate
	if req.Visibility != "" {
		switch req.Visibility {
		case model.VisibilityPrivate, model.VisibilityTeam, model.VisibilityPublic:
			visibility = req.Visibility
		default:
			badRequest(c, "visibility 必须是 private|team|public", nil)
			return
		}
	}
	p := &model.Project{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Description: req.Description,
		OwnerID:     userID,
		Visibility:  visibility,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := h.repo.CreateProject(c, p); err != nil {
		serverError(c, "创建项目失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionCreate, model.AuditTargetProject, p.ID,
		`{"name":"`+escapeJSON(p.Name)+`","visibility":"`+p.Visibility+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) GetProject(c *gin.Context) {
	id := c.Param("id")
	p, _, err := loadAccessibleProject(c, h.repo, id, PermRead)
	if err != nil || p == nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) UpdateProject(c *gin.Context) {
	id := c.Param("id")
	p, _, err := loadAccessibleProject(c, h.repo, id, PermWrite)
	if err != nil || p == nil {
		return
	}
	var req createProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	p.Name = req.Name
	p.Description = req.Description
	if req.Visibility != "" && (req.Visibility == model.VisibilityPrivate ||
		req.Visibility == model.VisibilityTeam || req.Visibility == model.VisibilityPublic) {
		// visibility 变更需要 admin；这里只放行 owner（loadAccessibleProject 已用 PermWrite 校验，
		// 但 visibility 是 admin 级别能力 — 用 held 二次校验）
		if c.GetString("user_id") != p.OwnerID {
			c.JSON(http.StatusForbidden, gin.H{"error": gin.H{
				"code": "E_FORBIDDEN", "message": "仅项目所有者可修改可见性",
			}})
			return
		}
		p.Visibility = req.Visibility
	}
	p.UpdatedAt = time.Now().UTC()
	if err := h.repo.UpdateProject(c, p); err != nil {
		serverError(c, "更新项目失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionUpdate, model.AuditTargetProject, p.ID,
		`{"name":"`+escapeJSON(p.Name)+`","visibility":"`+p.Visibility+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) DeleteProject(c *gin.Context) {
	id := c.Param("id")
	// 删除需要 admin 权限（事实上只有 owner 持有 admin）。
	p, _, err := loadAccessibleProject(c, h.repo, id, PermAdmin)
	if err != nil || p == nil {
		return
	}
	if err := h.repo.DeleteProject(c, id); err != nil {
		serverError(c, "删除项目失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionDelete, model.AuditTargetProject, id, "")
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// ─── Models ──────────────────────────────────────────────────────────

type createModelReq struct {
	ProjectID string `json:"projectId"`
	Name      string `json:"name" binding:"required,min=1,max=200"`
	Content   string `json:"content"`
}

type updateModelReq struct {
	Name    string `json:"name" binding:"required,min=1,max=200"`
	Content string `json:"content"`
	Version int    `json:"version" binding:"required,min=1"`
}

func (h *Handler) ListModels(c *gin.Context) {
	projectID := c.Query("projectId")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermRead); err != nil || !ok {
		return
	}
	models, err := h.repo.ListModelsByProject(c, projectID)
	if err != nil {
		serverError(c, "列出模型失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": models})
}

func (h *Handler) CreateModel(c *gin.Context) {
	var req createModelReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	if req.ProjectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, req.ProjectID, PermWrite); err != nil || !ok {
		return
	}
	m := &model.Model{
		ID:        uuid.NewString(),
		ProjectID: req.ProjectID,
		Name:      req.Name,
		Content:   req.Content,
		Version:   1,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := h.repo.CreateModel(c, m); err != nil {
		serverError(c, "创建模型失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionCreate, model.AuditTargetModel, m.ID,
		`{"name":"`+escapeJSON(m.Name)+`","project":"`+m.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// modelID 从嵌套路由 param "modelId" 或平坦路由 param "id" 中提取模型 ID。
func modelID(c *gin.Context) string {
	if id := c.Param("modelId"); id != "" {
		return id
	}
	return c.Param("id")
}

func (h *Handler) GetModel(c *gin.Context) {
	id := modelID(c)
	m, _, _, err := loadAccessibleModel(c, h.repo, id, PermRead)
	if err != nil || m == nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// SearchModels 跨项目搜索模型（M4.5 增量）。
//
// GET /api/v1/models/search?q=<keyword>&limit=<n>
// 搜索当前用户有 read 权限的项目下的模型名称 + 描述。
func (h *Handler) SearchModels(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		badRequest(c, "缺少搜索关键词 q", nil)
		return
	}
	limit := 20
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	userID := c.GetString("user_id")
	models, err := h.repo.SearchModels(c, q, userID, limit)
	if err != nil {
		serverError(c, "搜索模型失败", err)
		return
	}
	if models == nil {
		models = []*model.Model{}
	}
	c.JSON(http.StatusOK, gin.H{"data": models})
}

// ListModelVersions 返回模型的历史版本列表（M4.5 增量）。
func (h *Handler) ListModelVersions(c *gin.Context) {
	modelID := c.Param("modelId")
	if modelID == "" {
		badRequest(c, "缺少 modelId", nil)
		return
	}
	// 验证模型存在且当前用户有 read 权限
	_, _, _, lerr := loadAccessibleModel(c, h.repo, modelID, PermRead)
	if lerr != nil {
		return
	}
	limit := 20
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	versions, err := h.repo.ListModelVersions(c, modelID, limit)
	if err != nil {
		serverError(c, "查询版本历史失败", err)
		return
	}
	if versions == nil {
		versions = []*model.ModelVersion{}
	}
	c.JSON(http.StatusOK, gin.H{"data": versions})
}

func (h *Handler) UpdateModel(c *gin.Context) {
	id := modelID(c)
	m, _, _, err := loadAccessibleModel(c, h.repo, id, PermWrite)
	if err != nil || m == nil {
		return
	}
	var req updateModelReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	m.Name = req.Name
	m.Content = req.Content
	// 乐观锁：把 DB 读到的最新版本用 req.Version（客户端持有的版本）覆盖，
	// 让 repo 的 WHERE version = ? 匹配上 m.Version，从而正确触发 409。
	m.Version = req.Version
	m.UpdatedAt = time.Now().UTC()
	if err := h.repo.UpdateModel(c, m, c.GetString("user_id")); err != nil {
		if errors.Is(err, repository.ErrVersionConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_VERSION_CONFLICT",
				"message": "版本冲突，请刷新后重试",
			}})
			return
		}
		serverError(c, "更新模型失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionUpdate, model.AuditTargetModel, m.ID,
		`{"name":"`+escapeJSON(m.Name)+`","project":"`+m.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": m})
}

func (h *Handler) DeleteModel(c *gin.Context) {
	id := modelID(c)
	m, _, _, err := loadAccessibleModel(c, h.repo, id, PermWrite)
	if err != nil || m == nil {
		// m == nil 表示权限不足或不存在，loadAccessibleModel 已写响应
		return
	}
	if err := h.repo.DeleteModel(c, id); err != nil {
		serverError(c, "删除模型失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionDelete, model.AuditTargetModel, id,
		`{"name":"`+escapeJSON(m.Name)+`","project":"`+m.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// ─── 嵌套路由 wrappers（支持 /projects/:projectId/models）───────────────

// ListModelsByProject 从 URL 提取项目 ID，验证权限后列模型。
func (h *Handler) ListModelsByProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermRead); err != nil || !ok {
		return
	}
	models, err := h.repo.ListModelsByProject(c, projectID)
	if err != nil {
		serverError(c, "列出模型失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": models})
}

// CreateModelInProject 从 URL 提取项目 ID，验证权限后创建模型。
func (h *Handler) CreateModelInProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermWrite); err != nil || !ok {
		return
	}
	var req createModelReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	req.ProjectID = projectID
	m := &model.Model{
		ID:        uuid.NewString(),
		ProjectID: req.ProjectID,
		Name:      req.Name,
		Content:   req.Content,
		Version:   1,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := h.repo.CreateModel(c, m); err != nil {
		serverError(c, "创建模型失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionCreate, model.AuditTargetModel, m.ID,
		`{"name":"`+escapeJSON(m.Name)+`","project":"`+m.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// ─── Packages（M12 一等 SysML v2 实体） ────────────────────────────────

type createPackageReq struct {
	ProjectID       string            `json:"projectId"`
	ParentPackageID string            `json:"parentPackageId,omitempty"`
	Name            string            `json:"name" binding:"required,min=1,max=200"`
	Description     string            `json:"description"`
	Content         string            `json:"content"`
	Metadata        map[string]string `json:"metadata"`
}

type updatePackageReq struct {
	Name            string            `json:"name" binding:"required,min=1,max=200"`
	ParentPackageID string            `json:"parentPackageId,omitempty"`
	Description     string            `json:"description"`
	Content         string            `json:"content"`
	Metadata        map[string]string `json:"metadata"`
	Version         int               `json:"version" binding:"required,min=1"`
	// M13：可选 force=true 强制覆盖（绕过乐观锁），审计会记录 force_overwrite。
	// BaseVersion 用于 diff（前端编辑时基于的版本）；不传则取 req.Version。
	Force       bool `json:"force"`
	BaseVersion int  `json:"baseVersion"`
}

// packageID 从嵌套路由 param "packageId" 或平坦路由 param "id" 中提取 Package ID。
func packageID(c *gin.Context) string {
	if id := c.Param("packageId"); id != "" {
		return id
	}
	return c.Param("id")
}

// viewID 从嵌套路由 param "viewId" 或平坦路由 param "id" 中提取 View ID。
func viewID(c *gin.Context) string {
	if id := c.Param("viewId"); id != "" {
		return id
	}
	return c.Param("id")
}

// loadAccessiblePackage 通过 packageID 加载 package，再加载其 project 并验证权限。
// 返回 (package, project, heldPermission)；权限不足时由 authz 写入响应并返回 nil。
func loadAccessiblePackage(c *gin.Context, repo *repository.SQLiteRepository, id string, required Permission) (*model.Package, *model.Project, Permission, error) {
	p, err := repo.GetPackage(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		notFound(c, "包不存在")
		return nil, nil, 0, nil
	}
	if err != nil {
		serverError(c, "加载包失败", err)
		return nil, nil, 0, nil
	}
	prj, held, lerr := loadAccessibleProject(c, repo, p.ProjectID, required)
	if lerr != nil {
		return nil, nil, 0, lerr
	}
	if prj == nil {
		return nil, nil, 0, nil
	}
	return p, prj, held, nil
}

// loadAccessibleView 通过 viewID 加载 view，再加载其 project 并验证权限。
func loadAccessibleView(c *gin.Context, repo *repository.SQLiteRepository, id string, required Permission) (*model.View, *model.Project, Permission, error) {
	v, err := repo.GetView(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		notFound(c, "视图不存在")
		return nil, nil, 0, nil
	}
	if err != nil {
		serverError(c, "加载视图失败", err)
		return nil, nil, 0, nil
	}
	prj, held, lerr := loadAccessibleProject(c, repo, v.ProjectID, required)
	if lerr != nil {
		return nil, nil, 0, lerr
	}
	if prj == nil {
		return nil, nil, 0, nil
	}
	return v, prj, held, nil
}

// ListPackagesByProject GET /projects/:id/packages
func (h *Handler) ListPackagesByProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermRead); err != nil || !ok {
		return
	}
	pkgs, err := h.repo.ListPackagesByProject(c, projectID)
	if err != nil {
		serverError(c, "列出包失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": pkgs})
}

// CreatePackageInProject POST /projects/:id/packages
func (h *Handler) CreatePackageInProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermWrite); err != nil || !ok {
		return
	}
	var req createPackageReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	// 同包下重名 → SQLite UNIQUE 触发；前端可识别 409
	if req.ParentPackageID != "" {
		if _, err := h.repo.GetPackage(c, req.ParentPackageID); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				badRequest(c, "父包不存在", nil)
				return
			}
			serverError(c, "校验父包失败", err)
			return
		}
	}
	p := &model.Package{
		ID:              uuid.NewString(),
		ProjectID:       projectID,
		ParentPackageID: req.ParentPackageID,
		Name:            req.Name,
		Description:     req.Description,
		Content:         req.Content,
		Metadata:        req.Metadata,
		Version:         1,
		CreatedAt:       time.Now().UTC(),
		UpdatedAt:       time.Now().UTC(),
	}
	if err := h.repo.CreatePackage(c, p); err != nil {
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_PACKAGE_NAME_CONFLICT",
				"message": "同一父包下已存在同名包",
			}})
			return
		}
		serverError(c, "创建包失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionCreate, model.AuditTargetPackage, p.ID,
		`{"name":"`+escapeJSON(p.Name)+`","project":"`+p.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// GetPackage GET /packages/:id
func (h *Handler) GetPackage(c *gin.Context) {
	id := packageID(c)
	p, _, _, err := loadAccessiblePackage(c, h.repo, id, PermRead)
	if err != nil || p == nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// UpdatePackage PUT /packages/:id
func (h *Handler) UpdatePackage(c *gin.Context) {
	id := packageID(c)
	p, _, _, err := loadAccessiblePackage(c, h.repo, id, PermWrite)
	if err != nil || p == nil {
		return
	}
	var req updatePackageReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	// M13：版本冲突检测 — 在写之前先比对 req.Version 与 DB 当前版本，
	// 不匹配则返回 409 + diff details（base/server + hunks），让前端做三方合并。
	if !req.Force && req.Version != p.Version {
		details := h.buildConflictDetails(c, "package", p.ID, p.Version, p.Content, p.UpdatedAt, p.ProjectID, req.BaseVersion, req.Content)
		c.JSON(http.StatusConflict, gin.H{"error": gin.H{
			"code":    "E_VERSION_CONFLICT",
			"message": "版本冲突：服务器已有更新版本",
			"details": details,
		}})
		return
	}

	p.Name = req.Name
	p.ParentPackageID = req.ParentPackageID
	p.Description = req.Description
	p.Content = req.Content
	if req.Metadata != nil {
		p.Metadata = req.Metadata
	}
	// 乐观锁：把 DB 读到的最新版本用 req.Version（客户端持有的版本）覆盖
	// M13：force=true 时跳过 WHERE version=? 校验（直接覆盖）
	p.Version = req.Version
	p.UpdatedAt = time.Now().UTC()
	if err := h.repo.UpdatePackage(c, p); err != nil {
		if errors.Is(err, repository.ErrVersionConflict) {
			// 即便我们前面 pre-check 过仍可能 race（两个请求同时进来）；
			// 这里也返回完整 diff details。
			details := h.buildConflictDetails(c, "package", p.ID, p.Version, p.Content, p.UpdatedAt, p.ProjectID, req.BaseVersion, req.Content)
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_VERSION_CONFLICT",
				"message": "版本冲突：服务器已有更新版本",
				"details": details,
			}})
			return
		}
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_PACKAGE_NAME_CONFLICT",
				"message": "同一父包下已存在同名包",
			}})
			return
		}
		serverError(c, "更新包失败", err)
		return
	}
	// 审计：force 覆盖要特殊标记
	auditAction := model.AuditActionUpdate
	if req.Force {
		auditAction = model.AuditActionForceUpdate
	}
	writeAudit(c, h.repo, auditAction, model.AuditTargetPackage, p.ID,
		`{"name":"`+escapeJSON(p.Name)+`","project":"`+p.ProjectID+`","forced":`+strconv.FormatBool(req.Force)+`}`)

	// M13：广播 content_updated
	userID := c.GetString("user_id")
	uname := userID
	if u, _ := h.repo.GetUserByID(c, userID); u != nil {
		uname = u.Username
	}
	h.PublishContentUpdated("package:"+p.ID, userID, uname, p.Version)

	c.JSON(http.StatusOK, gin.H{"data": p})
}

// DeletePackage DELETE /packages/:id
func (h *Handler) DeletePackage(c *gin.Context) {
	id := packageID(c)
	p, _, _, err := loadAccessiblePackage(c, h.repo, id, PermWrite)
	if err != nil || p == nil {
		return
	}
	if err := h.repo.DeletePackage(c, id); err != nil {
		serverError(c, "删除包失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionDelete, model.AuditTargetPackage, id,
		`{"name":"`+escapeJSON(p.Name)+`","project":"`+p.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// ─── Views（M12 一等 SysML v2 实体） ──────────────────────────────────

type createViewReq struct {
	ProjectID         string            `json:"projectId"`
	PackageID         string            `json:"packageId,omitempty"`
	Name              string            `json:"name" binding:"required,min=1,max=200"`
	Description       string            `json:"description"`
	Content           string            `json:"content"`
	ColorTag          string            `json:"colorTag"`
	RenderingCategory string            `json:"renderingCategory"`
	Metadata          map[string]string `json:"metadata"`
}

type updateViewReq struct {
	Name              string            `json:"name" binding:"required,min=1,max=200"`
	PackageID         string            `json:"packageId,omitempty"`
	Description       string            `json:"description"`
	Content           string            `json:"content"`
	ColorTag          string            `json:"colorTag"`
	RenderingCategory string            `json:"renderingCategory"`
	Metadata          map[string]string `json:"metadata"`
	Version           int               `json:"version" binding:"required,min=1"`
	// M13：force 强制覆盖；BaseVersion 用于 diff
	Force       bool `json:"force"`
	BaseVersion int  `json:"baseVersion"`
}

// ListViewsByProject GET /projects/:id/views
func (h *Handler) ListViewsByProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermRead); err != nil || !ok {
		return
	}
	views, err := h.repo.ListViewsByProject(c, projectID)
	if err != nil {
		serverError(c, "列出视图失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": views})
}

// CreateViewInProject POST /projects/:id/views
func (h *Handler) CreateViewInProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermWrite); err != nil || !ok {
		return
	}
	var req createViewReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	if req.PackageID != "" {
		if _, err := h.repo.GetPackage(c, req.PackageID); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				badRequest(c, "所属包不存在", nil)
				return
			}
			serverError(c, "校验所属包失败", err)
			return
		}
	}
	v := &model.View{
		ID:                uuid.NewString(),
		ProjectID:         projectID,
		PackageID:         req.PackageID,
		Name:              req.Name,
		Description:       req.Description,
		Content:           req.Content,
		ColorTag:          req.ColorTag,
		RenderingCategory: req.RenderingCategory,
		Metadata:          req.Metadata,
		Kind:              model.ViewKindDefinition,
		RenderKind:        model.RenderKindInterconnection,
		Version:           1,
		CreatedAt:         time.Now().UTC(),
		UpdatedAt:         time.Now().UTC(),
	}
	// M15：用 ParseViewBodyWithPackages 做完整解析（含 resolve 校验）
	pkgsSummary, _ := h.repo.ListPackagesByProject(c, projectID)
	pkgRefs := parser.FromPackageSummaries(derefPackages(pkgsSummary))
	parsed := parser.ParseViewBodyWithPackages(req.Content, pkgRefs)
	v.ExposedElements = parsed.ExposedElements
	v.ExposedElementsUnresolved = parsed.ExposedElementsUnresolved
	v.RenderKind = parsed.RenderKind
	v.FilterQualifiedNames = parsed.FilterQualifiedNames
	v.InnerElements = parsed.InnerElements
	v.ViewpointQualifiedName = parsed.SatisfiesQualifiedName
	if err := h.repo.CreateView(c, v); err != nil {
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_VIEW_NAME_CONFLICT",
				"message": "同一包下已存在同名视图",
			}})
			return
		}
		serverError(c, "创建视图失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionCreate, model.AuditTargetView, v.ID,
		`{"name":"`+escapeJSON(v.Name)+`","project":"`+v.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": v})
}

// GetView GET /views/:id
func (h *Handler) GetView(c *gin.Context) {
	id := viewID(c)
	v, _, _, err := loadAccessibleView(c, h.repo, id, PermRead)
	if err != nil || v == nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": v})
}

// UpdateView PUT /views/:id
func (h *Handler) UpdateView(c *gin.Context) {
	id := viewID(c)
	v, _, _, err := loadAccessibleView(c, h.repo, id, PermWrite)
	if err != nil || v == nil {
		return
	}
	var req updateViewReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	// M13：版本冲突预检（与 UpdatePackage 同样逻辑）
	if !req.Force && req.Version != v.Version {
		details := h.buildConflictDetails(c, "view", v.ID, v.Version, v.Content, v.UpdatedAt, v.ProjectID, req.BaseVersion, req.Content)
		c.JSON(http.StatusConflict, gin.H{"error": gin.H{
			"code":    "E_VERSION_CONFLICT",
			"message": "版本冲突：服务器已有更新版本",
			"details": details,
		}})
		return
	}

	v.Name = req.Name
	v.PackageID = req.PackageID
	v.Description = req.Description
	v.Content = req.Content
	v.ColorTag = req.ColorTag
	v.RenderingCategory = req.RenderingCategory
	if req.Metadata != nil {
		v.Metadata = req.Metadata
	}
	// 乐观锁：把 DB 读到的最新版本用 req.Version（客户端持有的版本）覆盖
	v.Version = req.Version
	v.UpdatedAt = time.Now().UTC()
	// M15：使用 ParseViewBodyWithPackages 做完整解析（含 resolve 校验）
	pkgsSummary, _ := h.repo.ListPackagesByProject(c, v.ProjectID)
	pkgRefs := parser.FromPackageSummaries(derefPackages(pkgsSummary))
	parseFn := func(content string) ([]model.ExposedElement, []model.ExposedElement, model.RenderKind, []string, []model.InnerElement) {
		parsed := parser.ParseViewBodyWithPackages(content, pkgRefs)
		return parsed.ExposedElements, parsed.ExposedElementsUnresolved, parsed.RenderKind, parsed.FilterQualifiedNames, parsed.InnerElements
	}
	if err := h.repo.UpdateView(c, v, parseFn); err != nil {
		if errors.Is(err, repository.ErrVersionConflict) {
			details := h.buildConflictDetails(c, "view", v.ID, v.Version, v.Content, v.UpdatedAt, v.ProjectID, req.BaseVersion, req.Content)
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_VERSION_CONFLICT",
				"message": "版本冲突：服务器已有更新版本",
				"details": details,
			}})
			return
		}
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_VIEW_NAME_CONFLICT",
				"message": "同一包下已存在同名视图",
			}})
			return
		}
		serverError(c, "更新视图失败", err)
		return
	}
	auditAction := model.AuditActionUpdate
	if req.Force {
		auditAction = model.AuditActionForceUpdate
	}
	writeAudit(c, h.repo, auditAction, model.AuditTargetView, v.ID,
		`{"name":"`+escapeJSON(v.Name)+`","project":"`+v.ProjectID+`","forced":`+strconv.FormatBool(req.Force)+`}`)

	// M13：广播 content_updated
	userID := c.GetString("user_id")
	uname := userID
	if u, _ := h.repo.GetUserByID(c, userID); u != nil {
		uname = u.Username
	}
	h.PublishContentUpdated("view:"+v.ID, userID, uname, v.Version)

	c.JSON(http.StatusOK, gin.H{"data": v})
}

// DeleteView DELETE /views/:id
func (h *Handler) DeleteView(c *gin.Context) {
	id := viewID(c)
	v, _, _, err := loadAccessibleView(c, h.repo, id, PermWrite)
	if err != nil || v == nil {
		return
	}
	if err := h.repo.DeleteView(c, id); err != nil {
		serverError(c, "删除视图失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionDelete, model.AuditTargetView, id,
		`{"name":"`+escapeJSON(v.Name)+`","project":"`+v.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// isUniqueViolation 判定 SQLite 唯一约束冲突。
// modernc.org/sqlite 返回的错误字符串包含 "UNIQUE constraint failed"。
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") ||
		strings.Contains(msg, "constraint failed: UNIQUE")
}

// ─── 错误响应辅助 ─────────────────────────────────────────────────────

func badRequest(c *gin.Context, msg string, details any) {
	c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{
		"code":    "E_BAD_REQUEST",
		"message": msg,
		"details": details,
	}})
}

func notFound(c *gin.Context, msg string) {
	c.JSON(http.StatusNotFound, gin.H{"error": gin.H{
		"code":    "E_NOT_FOUND",
		"message": msg,
	}})
}

func serverError(c *gin.Context, msg string, err error) {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{
		"code":    "E_INTERNAL",
		"message": msg,
		"details": errMsg,
	}})
	fmt.Printf("[ERROR] %s: %v\n", msg, err)
}

// ─── 密码 hash（极简：sha256 + salt）───────────────────────────────────
// M1 不引入 bcrypt 减少依赖；生产前必须换为 bcrypt/argon2

const passwordSalt = "sysmlv2-mvp-salt-2026"

func hashPassword(pw string) string {
	// 简单 hash（仅用于 demo，不安全）
	h := sha256Sum(pw + passwordSalt)
	return "sha256:" + h
}

func checkPassword(pw, stored string) bool {
	parts := strings.SplitN(stored, ":", 2)
	if len(parts) != 2 || parts[0] != "sha256" {
		return false
	}
	return sha256Sum(pw+passwordSalt) == parts[1]
}

func sha256Sum(s string) string {
	return sha256Of(s)
}
