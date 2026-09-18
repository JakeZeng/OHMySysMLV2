// Package handler 实现 HTTP handler（直接调用 repository，避免 service 层冗余）。
package handler

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/sysmlv2/mbse-backend/internal/middleware"
	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// Handler 持有 repository 引用，提供所有 HTTP 处理函数。
type Handler struct {
	repo *repository.SQLiteRepository
}

// New 构造 Handler。
func New(repo *repository.SQLiteRepository) *Handler {
	return &Handler{repo: repo}
}

// ─── Health ──────────────────────────────────────────────────────────

func (h *Handler) Health(c *gin.Context) {
	// M4.5 增量：附带 DB ping + 资源计数，便于运维探活与监控。
	// 失败时仍返回 200（健康探针不应被资源统计拖死），但 status 字段标 degraded。
	dbStatus := "ok"
	if err := h.repo.DB().PingContext(c); err != nil {
		dbStatus = "degraded: " + err.Error()
	}
	counts := h.repo.Counts(c)

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"status":   "ok",
		"db":       dbStatus,
		"time":     time.Now().UTC().Format(time.RFC3339),
		"counts":   counts,
	}})
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
		// 登录失败也记录审计（IP + 尝试的用户名），用于异常检测
		writeAudit(c, h.repo, "login_fail", "user", "",
			`{"username":"`+escapeJSON(req.Username)+`"}`)
		badRequest(c, "用户名或密码错误", nil)
		return
	}

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
	_, _, lerr := loadAccessibleModel(c, h.repo, modelID, PermRead)
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
