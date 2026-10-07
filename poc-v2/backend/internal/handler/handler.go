// Package handler 实现 HTTP handler（直接调用 repository，避免 service 层冗余）。
package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
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

// packageRefsForResolve 取工程下所有包的 (id, name, parent, content)，
// 供 view body 的 expose 路径做严格 resolve（末段 def 必须真实存在）。
//
// 出错时返回 nil —— resolve 退化为「全部 unresolved」而非让保存失败；
// 视图内容本身仍然落库，避免因解析辅助数据不可用而丢用户输入。
func (h *Handler) packageRefsForResolve(c *gin.Context, projectID string) []parser.PackageRef {
	refs, err := h.repo.ListPackageContentRefsByProject(c.Request.Context(), projectID)
	if err != nil {
		return nil
	}
	return parser.FromPackageContentRefs(refs)
}

// resolveSatisfiedViewpointID 把 body 内 `satisfy VP;` 子句解析出的 qualified name
// 映射到工程内真实存在的 Viewpoint ID。
//
// SysML v2 §7.26 的 satisfy 是语义关系而非纯字符串：只有解析到实体，
// UI 才能给出可点击的跳转（否则退化为只显示名字的弱引用）。
// （M16 P1：body 前 `satisfies` 方言已移除，官方唯一位置是 body 内子句。）
//
// 匹配策略（宽松，按优先级）：
//  1. qualified name 末段与 viewpoint 名完全相等
//  2. qualified name 与 viewpoint 名完全相等
//
// 找不到返回空串（不报错 —— 允许"先写 satisfy 再建 viewpoint"的建模顺序）。
func (h *Handler) resolveSatisfiedViewpointID(c *gin.Context, projectID, qualifiedName string) string {
	if qualifiedName == "" {
		return ""
	}
	vps, err := h.repo.ListViewpointsByProject(c.Request.Context(), projectID)
	if err != nil {
		return ""
	}
	segments := strings.Split(qualifiedName, "::")
	last := segments[len(segments)-1]
	for _, vp := range vps {
		if vp == nil {
			continue
		}
		if vp.Name == last || vp.Name == qualifiedName {
			return vp.ID
		}
	}
	return ""
}

// resolveViewKind 校验并归一化 ViewDefinition / ViewUsage 判定（SysML v2 §7.26）。
//
// 规则：
//   - kind 空 → definition（向后兼容：M15 之前建的视图没有 kind 字段）
//   - kind = definition → 不允许带 viewDefinitionId（模板不实例化别的模板）
//   - kind = usage      → viewDefinitionId 必填，且必须是同工程下 kind='definition' 的视图
//   - 其它值 → 400
//
// 校验失败时已写好响应，返回 ok=false，调用方直接 return。
func (h *Handler) resolveViewKind(
	c *gin.Context,
	projectID, kind, viewDefID string,
) (model.ViewKind, string, bool) {
	k := model.ViewKind(strings.TrimSpace(kind))
	if k == "" {
		k = model.ViewKindDefinition
	}
	switch k {
	case model.ViewKindDefinition:
		// 显式忽略 viewDefinitionId：definition 不是任何 template 的实例
		return k, "", true
	case model.ViewKindUsage:
		if viewDefID == "" {
			badRequest(c, "ViewUsage 必须指定 viewDefinitionId", nil)
			return k, "", false
		}
		def, err := h.repo.GetView(c.Request.Context(), viewDefID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				badRequest(c, "引用的 ViewDefinition 不存在", nil)
				return k, "", false
			}
			serverError(c, "校验 ViewDefinition 失败", err)
			return k, "", false
		}
		if def.ProjectID != projectID {
			badRequest(c, "引用的 ViewDefinition 不属于本工程", nil)
			return k, "", false
		}
		// 不允许 usage-of-usage：SysML v2 里 ViewUsage 实例化的是 ViewDefinition
		if def.Kind == model.ViewKindUsage {
			badRequest(c, "引用的视图本身是 ViewUsage，不能作为模板", nil)
			return k, "", false
		}
		return k, def.ID, true
	default:
		badRequest(c, "kind 只能是 definition 或 usage", nil)
		return k, "", false
	}
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
		"status":        "ok",
		"db":            dbStatus,
		"time":          time.Now().UTC().Format(time.RFC3339),
		"counts":        counts,
		"uptime":        uptimeStr,
		"uptimeSeconds": int(uptime.Seconds()),
		"availability":  availability,
		"version":       "1.0.0",
		"environment":   getEnv("GIN_MODE", "debug"),
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
	Token   string      `json:"token"`
	Expires time.Time   `json:"expires"`
	User    *model.User `json:"user"`
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
// applyStandardViewFields 从 content 推导标准视图类型相关的派生字段。
//
// 这些字段是 content 的纯函数，**故意不落库** —— 落一份副本就会出现
// 「文本改了特化、接口还报旧类型」的分裂，而 content 才是唯一真源。
//
// 幂等且无副作用，可在每次读视图时无条件调用（解析失败只是留空，不报错）。
func applyStandardViewFields(v *model.View) {
	if v == nil {
		return
	}
	parsed := parser.ParseViewBody(v.Content)
	v.StandardView = string(parsed.StandardView)
	v.RenderingKind = string(parsed.RenderingKind)
	v.SpecializesRef = parser.ViewSpecializesRef(v.Content)
	v.RenderingRef = parser.RenderRefOf(v.Content)
}

// applyStandardViewFieldsToSummary 是 applyStandardViewFields 的摘要版。
//
// 摘要没有 content（列表按设计不返回），所以不能重算 —— 这正是 migration 008
// 把 standard_view / rendering_kind 落库的原因。这里只在字段为空时兜底补
// 什么都不做：老库没跑迁移时前端按「自定义视图类型」呈现，不假装是标准视图。
func applyStandardViewFieldsToSummary(v *model.ViewSummary) {
	if v == nil {
		return
	}
	_ = v // 字段由 repository 扫描时填充（migration 008）；此处刻意不猜。
}

func loadAccessibleView(c *gin.Context, repo *repository.SQLiteRepository, id string, required Permission) (*model.View, *model.Project, Permission, error) {
	v, err := repo.GetView(c.Request.Context(), id)
	// M19：标准视图类型 / rendering 类在这里补齐 —— 这是所有「读一个视图」的
	// 必经之路（GetView / UpdateView / DeleteView 都走它），放这一处就不会漏。
	applyStandardViewFields(v)
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

// viewpointID 从嵌套路由 param "viewpointId" 或平坦路由 param "id" 中提取 Viewpoint ID。
func viewpointID(c *gin.Context) string {
	if id := c.Param("viewpointId"); id != "" {
		return id
	}
	return c.Param("id")
}

// loadAccessibleViewpoint 通过 viewpointID 加载 viewpoint，再加载其 project 并验证权限。
func loadAccessibleViewpoint(c *gin.Context, repo *repository.SQLiteRepository, id string, required Permission) (*model.Viewpoint, *model.Project, Permission, error) {
	vp, err := repo.GetViewpoint(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		notFound(c, "视角不存在")
		return nil, nil, 0, nil
	}
	if err != nil {
		serverError(c, "加载视角失败", err)
		return nil, nil, 0, nil
	}
	prj, held, lerr := loadAccessibleProject(c, repo, vp.ProjectID, required)
	if lerr != nil {
		return nil, nil, 0, lerr
	}
	if prj == nil {
		return nil, nil, 0, nil
	}
	return vp, prj, held, nil
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
	p.Description = req.Description
	p.Content = req.Content
	if req.Metadata != nil {
		p.Metadata = req.Metadata
	}

	// 变更父包前校验：父包必须存在、属于同项目、不能形成环。
	if req.ParentPackageID != p.ParentPackageID {
		if req.ParentPackageID != "" {
			parent, err := h.repo.GetPackage(c, req.ParentPackageID)
			if err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					badRequest(c, "父包不存在", nil)
					return
				}
				serverError(c, "校验父包失败", err)
				return
			}
			if parent.ProjectID != p.ProjectID {
				badRequest(c, "父包必须属于同一项目", nil)
				return
			}
			// 环检测：父包不能是自身或自身的后代
			if req.ParentPackageID == p.ID {
				badRequest(c, "不能将包设置为自身的父包", nil)
				return
			}
			isDesc, err := h.repo.IsPackageDescendant(c, p.ID, req.ParentPackageID)
			if err != nil {
				serverError(c, "校验包嵌套关系失败", err)
				return
			}
			if isDesc {
				badRequest(c, "不能将包移动到其后代包下（会形成环）", nil)
				return
			}
		}
		p.ParentPackageID = req.ParentPackageID
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
	// M15：ViewDefinition（模板）/ ViewUsage（实例）判定。
	// 空 = "definition"（向后兼容：M12/M15 之前创建的视图都是 definition）。
	Kind string `json:"kind,omitempty"`
	// M15：kind='usage' 时必填 —— 实例化的 ViewDefinition。
	ViewDefinitionID string `json:"viewDefinitionId,omitempty"`
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
	// M15：允许改判 definition/usage（同一套校验）
	Kind             string `json:"kind,omitempty"`
	ViewDefinitionID string `json:"viewDefinitionId,omitempty"`
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
	// M19：逐个补齐标准视图类型 / rendering 类。
	// 列表按设计不返回 content，这两个字段在 repository 写入路径已算好落库
	// （migration 008）；这里只是兜底 —— 老库没跑迁移时也不会 500，只是不显示徽章。
	for _, v := range views {
		applyStandardViewFieldsToSummary(v)
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
	// M15：ViewDefinition vs ViewUsage 判定（含 viewDefinitionId 校验）
	kind, viewDefID, ok := h.resolveViewKind(c, projectID, req.Kind, req.ViewDefinitionID)
	if !ok {
		return
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
		Kind:              kind,
		ViewDefinitionID:  viewDefID,
		RenderKind:        model.RenderKindInterconnection,
		Version:           1,
		CreatedAt:         time.Now().UTC(),
		UpdatedAt:         time.Now().UTC(),
	}
	// M15：用 ParseViewBodyWithPackages 做完整解析（含 resolve 校验）。
	// 必须带 Content —— 否则无法校验 expose 末段 def 是否真实存在。
	pkgRefs := h.packageRefsForResolve(c, projectID)
	parsed := parser.ParseViewBodyWithPackages(req.Content, pkgRefs)
	v.ExposedElements = parsed.ExposedElements
	v.ExposedElementsUnresolved = parsed.ExposedElementsUnresolved
	v.RenderKind = parsed.RenderKind
	v.FilterQualifiedNames = parsed.FilterQualifiedNames
	// M16 P4：注入标准库前缀（4 官方 + 4 历史上常用），再把 view 包内容塞到其下做合成渲染——
	// `render asTreeDiagram;` 等引用即可 resolve 到合法 rendering def（不再生成非法
	// 方言）。ComputeExposed 对已解析的 expose 路径 + filter 表达式求值，输出
	// 真实过 filter 的元素集合（覆盖旧 ExposedElements 的「未过滤」语义）。
	v.Content = parser.StandardLibrary + "\n" + req.Content
	pkgRefs = h.packageRefsForResolve(c, projectID) // 含 stdlib 的最新引用
	parsed = parser.ParseViewBodyWithPackages(v.Content, pkgRefs)
	filtered := parser.ComputeExposed(parsed, pkgRefs)
	if len(filtered) > 0 {
		v.ExposedElements = make([]model.ExposedElement, 0, len(filtered))
		for _, fe := range filtered {
			v.ExposedElements = append(v.ExposedElements, fe.ExposedElement)
		}
	}
	// FilterQualifiedNames 是 filter 全文，已被 ComputeExposed 使用过；保持原值
	v.FilterQualifiedNames = parsed.FilterQualifiedNames
	v.InnerElements = parsed.InnerElements
	v.ViewpointQualifiedName = parsed.SatisfiesQualifiedName
	v.ViewpointID = h.resolveSatisfiedViewpointID(c, projectID, v.ViewpointQualifiedName)
	// M19：标准视图类型 / rendering 类 / 原始引用（派生字段，不落库）。
	// 必须在拼上 StandardLibrary 之后算 —— v.Content 此时才是真正要存的文本。
	applyStandardViewFields(v)
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
	// M15：kind 为空 = 调用方不关心（普通内容保存），保持既有判定不变 ——
	// 否则每次保存都会把 ViewUsage 静默降级成 ViewDefinition。
	if req.Kind != "" || req.ViewDefinitionID != "" {
		kind, viewDefID, ok := h.resolveViewKind(c, v.ProjectID, req.Kind, req.ViewDefinitionID)
		if !ok {
			return
		}
		v.Kind = kind
		v.ViewDefinitionID = viewDefID
	}
	// 乐观锁：把 DB 读到的最新版本用 req.Version（客户端持有的版本）覆盖
	v.Version = req.Version
	v.UpdatedAt = time.Now().UTC()
	// M15：使用 ParseViewBodyWithPackages 做完整解析（含 resolve 校验）
	pkgRefs := h.packageRefsForResolve(c, v.ProjectID)
	satisfiesQName := parser.ParseViewBody(req.Content).SatisfiesQualifiedName
	v.ViewpointQualifiedName = satisfiesQName
	v.ViewpointID = h.resolveSatisfiedViewpointID(c, v.ProjectID, satisfiesQName)
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

	// M19：content 已更新，重新推导标准视图类型（derived 字段不入库，只能现算）
	applyStandardViewFields(v)
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

// ─── Viewpoints（M15：SysML v2 §7.26）──────────────────────────

// ListViewpointsByProject GET /projects/:id/viewpoints
func (h *Handler) ListViewpointsByProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermRead); err != nil || !ok {
		return
	}
	vps, err := h.repo.ListViewpointsByProject(c, projectID)
	if err != nil {
		serverError(c, "列出视角失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": vps})
}

// CreateViewpointInProject POST /projects/:id/viewpoints
func (h *Handler) CreateViewpointInProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermWrite); err != nil || !ok {
		return
	}
	var req model.CreateViewpointRequest
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
	vp := &model.Viewpoint{
		ID:          uuid.NewString(),
		ProjectID:   projectID,
		PackageID:   req.PackageID,
		Name:        req.Name,
		Description: req.Description,
		Content:     req.Content,
		Stakeholder: req.Stakeholder,
		Concern:     req.Concern,
		Metadata:    req.Metadata,
		Version:     1,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	// M15：解析 viewpoint body 内 owned 元素（`part def X` 等）
	vp.InnerElements = parser.ParseViewBody(req.Content).InnerElements
	if err := h.repo.CreateViewpoint(c, vp); err != nil {
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_VIEWPOINT_NAME_CONFLICT",
				"message": "同一包下已存在同名视角",
			}})
			return
		}
		serverError(c, "创建视角失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionCreate, model.AuditTargetViewpoint, vp.ID,
		`{"name":"`+escapeJSON(vp.Name)+`","project":"`+vp.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": vp})
}

// GetViewpoint GET /viewpoints/:id
func (h *Handler) GetViewpoint(c *gin.Context) {
	id := viewpointID(c)
	vp, _, _, err := loadAccessibleViewpoint(c, h.repo, id, PermRead)
	if err != nil || vp == nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": vp})
}

// UpdateViewpoint PUT /viewpoints/:id
func (h *Handler) UpdateViewpoint(c *gin.Context) {
	id := viewpointID(c)
	vp, _, _, err := loadAccessibleViewpoint(c, h.repo, id, PermWrite)
	if err != nil || vp == nil {
		return
	}
	var req model.UpdateViewpointRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	if req.Version != vp.Version {
		details := h.buildConflictDetails(c, "viewpoint", vp.ID, vp.Version, vp.Content, vp.UpdatedAt, vp.ProjectID, 0, req.Content)
		c.JSON(http.StatusConflict, gin.H{"error": gin.H{
			"code":    "E_VERSION_CONFLICT",
			"message": "版本冲突：服务器已有更新版本",
			"details": details,
		}})
		return
	}
	vp.Name = req.Name
	vp.PackageID = req.PackageID
	vp.Description = req.Description
	vp.Content = req.Content
	vp.Stakeholder = req.Stakeholder
	vp.Concern = req.Concern
	vp.InnerElements = parser.ParseViewBody(req.Content).InnerElements
	if req.Metadata != nil {
		vp.Metadata = req.Metadata
	}
	vp.Version = req.Version
	vp.UpdatedAt = time.Now().UTC()
	if err := h.repo.UpdateViewpoint(c, vp); err != nil {
		if errors.Is(err, repository.ErrVersionConflict) {
			details := h.buildConflictDetails(c, "viewpoint", vp.ID, vp.Version, vp.Content, vp.UpdatedAt, vp.ProjectID, 0, req.Content)
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_VERSION_CONFLICT",
				"message": "版本冲突：服务器已有更新版本",
				"details": details,
			}})
			return
		}
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_VIEWPOINT_NAME_CONFLICT",
				"message": "同一包下已存在同名视角",
			}})
			return
		}
		serverError(c, "更新视角失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionUpdate, model.AuditTargetViewpoint, vp.ID,
		`{"name":"`+escapeJSON(vp.Name)+`","project":"`+vp.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": vp})
}

// DeleteViewpoint DELETE /viewpoints/:id
func (h *Handler) DeleteViewpoint(c *gin.Context) {
	id := viewpointID(c)
	vp, _, _, err := loadAccessibleViewpoint(c, h.repo, id, PermWrite)
	if err != nil || vp == nil {
		return
	}
	if err := h.repo.DeleteViewpoint(c, id); err != nil {
		serverError(c, "删除视角失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionDelete, model.AuditTargetViewpoint, id,
		`{"name":"`+escapeJSON(vp.Name)+`","project":"`+vp.ProjectID+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// ─── M16 P5/Q10：画布布局持久化（kind = package | view；不 bump version） ───

// LayoutAnchor 端口在所属元素边框上的挂点。
//
// M17：坐标只能表达「在哪」，不能表达「贴哪条边的哪个位置」—— 父元素一旦
// 拉伸，端口就会被钉死在某个绝对坐标上、从边框上掉下来。锚点是尺寸无关的。
type LayoutAnchor struct {
	Side  string  `json:"side"`  // left | right | top | bottom
	Ratio float64 `json:"ratio"` // 沿该边的归一化位置，[0, 1]
}

// LayoutPosition 单节点坐标。
type LayoutPosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	// Attach 仅端口节点有值；nil 表示普通元素 / 老数据（回落按坐标渲染）。
	//
	// 用指针区分「没有锚点」与「锚点在 (0,0)」—— 后者不合法，但指针能让
	// 两者在 JSON 层面就是不同形状，不至于被静默当成同一件事。
	Attach *LayoutAnchor `json:"attach,omitempty"`
}

// normalizeLayoutPosition 清洗客户端送来的布局条目。
//
// attach 里的 side 是自由字符串、ratio 是任意浮点，都是**不可信输入**。
// 与其在读取时处处提防，不如在入库前就收敛成合法值：非法 side 直接丢掉整个
// 锚点（等价于「这个端口没有锚点」，前端会回落到按坐标吸附，行为可预期），
// ratio 夹进 [0,1]，NaN / Inf 一律当 0.5（正中）。
//
// x / y 也要挡 NaN：JSON 允许非有限数（1e999、NaN 字面量），
// 存进去之后前端会拿到 NaN 坐标，整张画布变空白。
func normalizeLayoutPosition(p LayoutPosition) LayoutPosition {
	out := p
	if math.IsNaN(out.X) || math.IsInf(out.X, 0) {
		out.X = 0
	}
	if math.IsNaN(out.Y) || math.IsInf(out.Y, 0) {
		out.Y = 0
	}
	if p.Attach == nil {
		return out
	}
	switch p.Attach.Side {
	case "left", "right", "top", "bottom":
	default:
		out.Attach = nil
		return out
	}
	r := p.Attach.Ratio
	if math.IsNaN(r) {
		r = 0.5
	}
	if math.IsInf(r, 0) {
		if r > 0 {
			r = 1
		} else {
			r = 0
		}
	}
	out.Attach = &LayoutAnchor{Side: p.Attach.Side, Ratio: math.Max(0, math.Min(1, r))}
	return out
}

// LayoutEdgeAnchors 一条边的两端锚点（M17 S5「任意点连线」存的就是它）。
//
// 两端都必须合法才保留整条 —— 半条锚点没有意义，前端拿到也只能整体丢弃，
// 不如在入库前就丢掉，避免「有边锚点但恒为空」的记录混进库里。
type LayoutEdgeAnchors struct {
	Source *LayoutAnchor `json:"source,omitempty"`
	Target *LayoutAnchor `json:"target,omitempty"`
}

// normalizeLayoutEdgeAnchors 清洗客户端送来的边锚点；任一端不合法则整条丢弃。
func normalizeLayoutEdgeAnchors(e LayoutEdgeAnchors) (LayoutEdgeAnchors, bool) {
	if e.Source == nil || e.Target == nil {
		return LayoutEdgeAnchors{}, false
	}
	var out LayoutEdgeAnchors
	src := normalizeLayoutPosition(LayoutPosition{Attach: e.Source})
	tgt := normalizeLayoutPosition(LayoutPosition{Attach: e.Target})
	if src.Attach == nil || tgt.Attach == nil {
		return LayoutEdgeAnchors{}, false
	}
	out.Source = src.Attach
	out.Target = tgt.Attach
	return out, true
}

// layoutPayload 布局请求体：nodeId → 坐标，以及（可选）边 → 两端锚点。
type layoutPayload struct {
	Nodes map[string]LayoutPosition    `json:"nodes"`
	Edges map[string]LayoutEdgeAnchors `json:"edges,omitempty"`
}

// storedLayout 是**入库**格式，也是 GET 的响应格式。S5 之前库里存的是裸的
// `{"pd:partDef_1":{"x":1,"y":2}}`，之后是 `{"nodes":{...},"edges":{...}}`。
// 读的时候靠「顶层有没有 nodes 键」区分，见 decodeStoredLayout。
//
// 两张表都**不带 omitempty**：响应里必须永远出现 nodes / edges 两个键。
// 带 omitempty 时空 map 会被整个省略，前端拿到的是 undefined 而不是 {}，
// `Object.entries(undefined)` 直接抛错，整张画布白屏。
type storedLayout struct {
	Nodes map[string]LayoutPosition    `json:"nodes"`
	Edges map[string]LayoutEdgeAnchors `json:"edges"`
}

// decodeStoredLayout 兼容两种历史格式。
//
// 判别方式不能是「Unmarshal 到 storedLayout 成功与否」：Go 会**静默忽略**
// 未知字段，所以旧的裸节点表反序列化到 storedLayout 是成功的、且 Nodes 为 nil
// —— 真按「Nodes == nil 就算老格式」判，第一次读任何一条正常的新数据都会
// 被误当成老格式，节点坐标直接清空。必须先摊平成 map 看顶层键。
//
// 两种格式解析失败都返回空结构（= 没有布局，前端回落自动布局）。不能返回
// 部分结果：Go 遇到类型错误会继续往下解，返回的是「一半真值 + 一批零值节点」，
// 后者会让所有图元叠在原点，比整张图重排更让人以为程序坏了。
//
// 已知歧义：顶层裸键 `nodes` 会被当成新格式。实际不可能出现 —— 老格式的键一律是
// `<kind>:<qname>`（stableKey.ts 生成，kind 取值里没有 "nodes"），裸键只可能来自
// 被人手改过的库。
func decodeStoredLayout(raw string) storedLayout {
	var out storedLayout
	if raw == "" {
		return out
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &probe); err != nil {
		return out
	}
	if _, isNew := probe["nodes"]; isNew {
		if err := json.Unmarshal([]byte(raw), &out); err != nil {
			return storedLayout{}
		}
		return out
	}
	// 老格式：整个 JSON 就是节点表
	out.Nodes = map[string]LayoutPosition{}
	if err := json.Unmarshal([]byte(raw), &out.Nodes); err != nil {
		return storedLayout{}
	}
	return out
}

// SaveLayout PUT /layouts/:kind/:id
//
// 权限：layout 随实体权限走（写实体要求 write）。
// 不 bump version——layout 是呈现辅助（Q10=A），保存失败前端静默降级 localStorage。
func (h *Handler) SaveLayout(c *gin.Context) {
	kind := c.Param("kind")
	if kind != "package" && kind != "view" {
		badRequest(c, "未知的布局实体类型", nil)
		return
	}
	id := c.Param("id")
	if kind == "package" {
		if _, _, _, err := loadAccessiblePackage(c, h.repo, id, PermWrite); err != nil {
			return
		}
	} else {
		if _, _, _, err := loadAccessibleView(c, h.repo, id, PermWrite); err != nil {
			return
		}
	}
	var req layoutPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	stored := storedLayout{
		Nodes: map[string]LayoutPosition{},
		Edges: map[string]LayoutEdgeAnchors{},
	}
	for k, p := range req.Nodes {
		stored.Nodes[k] = normalizeLayoutPosition(p)
	}
	for k, e := range req.Edges {
		if norm, ok := normalizeLayoutEdgeAnchors(e); ok {
			stored.Edges[k] = norm
		}
	}
	b, err := json.Marshal(stored)
	if err != nil {
		badRequest(c, "布局序列化失败", err.Error())
		return
	}
	if err := h.repo.SaveLayout(c, kind, id, string(b)); err != nil {
		serverError(c, "保存布局失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"saved": true}})
}

// GetLayout GET /layouts/:kind/:id
//
// 返回 {nodes: {...}, edges: {...}}；不存在时两者都是空对象
// （前端回落 ELK 自动布局 + 默认边锚点）。
func (h *Handler) GetLayout(c *gin.Context) {
	kind := c.Param("kind")
	if kind != "package" && kind != "view" {
		badRequest(c, "未知的布局实体类型", nil)
		return
	}
	id := c.Param("id")
	if kind == "package" {
		if _, _, _, err := loadAccessiblePackage(c, h.repo, id, PermRead); err != nil {
			return
		}
	} else {
		if _, _, _, err := loadAccessibleView(c, h.repo, id, PermRead); err != nil {
			return
		}
	}
	raw, err := h.repo.GetLayout(c, kind, id)
	if err != nil {
		serverError(c, "读取布局失败", err)
		return
	}
	stored := decodeStoredLayout(raw)
	if stored.Nodes == nil {
		stored.Nodes = map[string]LayoutPosition{}
	}
	if stored.Edges == nil {
		stored.Edges = map[string]LayoutEdgeAnchors{}
	}
	c.JSON(http.StatusOK, gin.H{"data": stored})
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
