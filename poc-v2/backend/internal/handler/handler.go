// Package handler 实现 HTTP handler（直接调用 repository，避免 service 层冗余）。
package handler

import (
	"database/sql"
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
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
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
		badRequest(c, "用户名或密码错误", nil)
		return
	}

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

// ─── Projects ────────────────────────────────────────────────────────

type createProjectReq struct {
	Name        string `json:"name" binding:"required,min=1,max=100"`
	Description string `json:"description"`
}

func (h *Handler) ListProjects(c *gin.Context) {
	userID := c.GetString("user_id")
	projects, err := h.repo.ListProjectsByUser(c, userID)
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
	p := &model.Project{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Description: req.Description,
		OwnerID:     userID,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := h.repo.CreateProject(c, p); err != nil {
		serverError(c, "创建项目失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) GetProject(c *gin.Context) {
	id := c.Param("id")
	p, err := h.repo.GetProject(c, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, repository.ErrNotFound) {
			notFound(c, "项目不存在")
			return
		}
		serverError(c, "获取项目失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) UpdateProject(c *gin.Context) {
	id := c.Param("id")
	var req createProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	p, err := h.repo.GetProject(c, id)
	if err != nil {
		notFound(c, "项目不存在")
		return
	}
	p.Name = req.Name
	p.Description = req.Description
	p.UpdatedAt = time.Now().UTC()
	if err := h.repo.UpdateProject(c, p); err != nil {
		serverError(c, "更新项目失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) DeleteProject(c *gin.Context) {
	id := c.Param("id")
	if err := h.repo.DeleteProject(c, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			notFound(c, "项目不存在")
			return
		}
		serverError(c, "删除项目失败", err)
		return
	}
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
	m, err := h.repo.GetModel(c, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, repository.ErrNotFound) {
			notFound(c, "模型不存在")
			return
		}
		serverError(c, "获取模型失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

func (h *Handler) UpdateModel(c *gin.Context) {
	id := modelID(c)
	var req updateModelReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	m, err := h.repo.GetModel(c, id)
	if err != nil {
		notFound(c, "模型不存在")
		return
	}
	m.Name = req.Name
	m.Content = req.Content
	// 乐观锁：把 DB 读到的最新版本用 req.Version（客户端持有的版本）覆盖，
	// 让 repo 的 WHERE version = ? 匹配上 m.Version，从而正确触发 409。
	m.Version = req.Version
	m.UpdatedAt = time.Now().UTC()
	if err := h.repo.UpdateModel(c, m); err != nil {
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
	c.JSON(http.StatusOK, gin.H{"data": m})
}

func (h *Handler) DeleteModel(c *gin.Context) {
	id := modelID(c)
	if err := h.repo.DeleteModel(c, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			notFound(c, "模型不存在")
			return
		}
		serverError(c, "删除模型失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// ─── 嵌套路由 wrappers（支持 /projects/:projectId/models）───────────────

// ListModelsByProject 从 URL 提取项目 ID，转发给 ListModels。
func (h *Handler) ListModelsByProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
		return
	}
	models, err := h.repo.ListModelsByProject(c, projectID)
	if err != nil {
		serverError(c, "列出模型失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": models})
}

// CreateModelInProject 从 URL 提取项目 ID，注入请求体后创建模型。
func (h *Handler) CreateModelInProject(c *gin.Context) {
	projectID := c.Param("id")
	if projectID == "" {
		badRequest(c, "projectId 必填", nil)
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
