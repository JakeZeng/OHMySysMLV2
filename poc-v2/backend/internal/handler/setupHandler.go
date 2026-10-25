// Package handler — 首次安装引导（setup wizard）端点（M18）。
//
// 设计目标：安装包解压后直接启动 → 浏览器自动打开 → 用户在网页上完成
// 「管理员账号 + AI 配置」两步引导 → 应用可用。全程无需手工编辑配置文件。
//
// 接口：
//
//	GET  /api/v1/setup/status    安装状态（是否需要引导 / 已完成到哪一步）
//	POST /api/v1/setup/admin     创建管理员账号（第一步）
//	POST /api/v1/setup/ai        保存 AI 供应商配置（第二步，可跳过）
//	POST /api/v1/setup/complete  标记引导完成（第三步）
//
// 安全约束：
//   - 仅当「需要引导」时才允许写入；完成后所有写接口返回 409。
//   - SETUP_DISABLED=1 可完全关闭引导（老实例 / 容器化部署场景）。
//   - 管理员密码只存 hash（复用现有 hashPassword）。
package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// setupAdminMarkerKey 记录向导已创建管理员（用于区分「向导进行中」与「老安装已有用户」）。
const setupAdminMarkerKey = "setup_admin_created"

// SetupHandler 处理首次安装引导相关端点。
type SetupHandler struct {
	repo     *repository.SQLiteRepository
	ai       *AIHandler
	version  string
	disabled bool
}

// NewSetupHandler 构造 SetupHandler。
//
// version 来自构建期 ldflags（main.version），disabled 来自 SETUP_DISABLED 环境变量。
func NewSetupHandler(repo *repository.SQLiteRepository, ai *AIHandler, version string, disabled bool) *SetupHandler {
	return &SetupHandler{repo: repo, ai: ai, version: version, disabled: disabled}
}

// setupStatusResp 安装状态响应。
type setupStatusResp struct {
	Initialized  bool     `json:"initialized"`
	NeedsSetup   bool     `json:"needsSetup"`
	Version      string   `json:"version"`
	Steps        []string `json:"steps"`
	AdminCreated bool     `json:"adminCreated"`
	AIConfigured bool     `json:"aiConfigured"`
	Provider     string   `json:"provider"`
	Model        string   `json:"model"`
	BaseURL      string   `json:"baseUrl"`
	APIKeyMasked string   `json:"apiKeyMasked"`
	AppURL       string   `json:"appUrl"`
}

// Status GET /api/v1/setup/status
//
// 判定「需要引导」的三条规则（顺序即优先级）：
//  1. SETUP_DISABLED=1 → 永不引导。
//  2. setup_state.initialized=1 → 已完成。
//  3. 库里已有用户且不是向导创建的（老安装/升级上来）→ 视为已完成并回写状态，
//     避免老用户升级后被要求重走向导。
func (h *SetupHandler) Status(c *gin.Context) {
	state, err := h.repo.GetSetupState(c)
	if err != nil {
		serverError(c, "读取安装状态失败", err)
		return
	}

	settings, err := h.repo.AllSettings(c)
	if err != nil {
		serverError(c, "读取应用设置失败", err)
		return
	}

	users, err := h.repo.CountUsers(c)
	if err != nil {
		serverError(c, "读取用户数失败", err)
		return
	}

	initialized := state.Initialized
	if !initialized && h.disabled {
		initialized = true
	}

	// 老安装兼容：库里已有用户、但不是本次向导创建的 → 视为已完成并回写。
	if !initialized && users > 0 && settings[setupAdminMarkerKey] == "" {
		initialized = true
		_ = h.repo.MarkSetupInitialized(c, "legacy", h.version)
	}

	adminCreated := settings[setupAdminMarkerKey] != ""
	provider := settings["ai_provider"]
	apiKey := settings["ai_api_key"]
	if provider == "anthropic" {
		apiKey = settings["anthropic_api_key"]
	}

	c.JSON(http.StatusOK, gin.H{"data": setupStatusResp{
		Initialized:  initialized,
		NeedsSetup:   !initialized,
		Version:      h.version,
		Steps:        []string{"admin", "ai", "complete"},
		AdminCreated: adminCreated,
		AIConfigured: apiKey != "",
		Provider:     provider,
		Model:        settings["ai_model"],
		BaseURL:      settings["ai_base_url"],
		APIKeyMasked: maskSecret(apiKey),
		AppURL:       appBaseURL(c),
	}})
}

// setupAdminReq 创建管理员请求体。
type setupAdminReq struct {
	Username string `json:"username" binding:"required"`
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// CreateAdmin POST /api/v1/setup/admin
//
// 幂等性：向导可重复调用；同名用户已存在时直接返回该用户（不覆盖密码）。
func (h *SetupHandler) CreateAdmin(c *gin.Context) {
	ok := h.ensureSetupAllowed(c)
	if !ok {
		return
	}

	var req setupAdminReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.TrimSpace(req.Email)
	if len(req.Username) < 3 {
		badRequest(c, "用户名至少 3 个字符", nil)
		return
	}
	if !strings.Contains(req.Email, "@") {
		badRequest(c, "邮箱格式不正确", nil)
		return
	}
	if len(req.Password) < 6 {
		badRequest(c, "密码至少 6 个字符", nil)
		return
	}

	// 已创建过 → 幂等返回
	if marker, _ := h.repo.GetSetting(c, setupAdminMarkerKey); marker != "" {
		if u, _ := h.repo.GetUserByUsername(c, req.Username); u != nil {
			h.respondAdmin(c, u)
			return
		}
		badRequest(c, "管理员账号已创建，无法重复创建", nil)
		return
	}

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
		serverError(c, "创建管理员失败", err)
		return
	}
	if err := h.repo.SetSetting(c, setupAdminMarkerKey, user.ID); err != nil {
		serverError(c, "写入安装标记失败", err)
		return
	}

	writeAudit(c, h.repo, "setup_admin", "user", user.ID,
		`{"username":"`+escapeJSON(user.Username)+`"}`)

	h.respondAdmin(c, user)
}

// respondAdmin 返回管理员信息 + 登录 token（向导结束后可直接进入系统）。
func (h *SetupHandler) respondAdmin(c *gin.Context, u *model.User) {
	token, expires, err := newToken(u.ID)
	if err != nil {
		serverError(c, "生成 token 失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tokenResp{
		Token:   token,
		Expires: expires,
		User:    u,
	}})
}

// setupAIReq AI 配置请求体。
type setupAIReq struct {
	Provider string `json:"provider"`
	APIKey   string `json:"apiKey"`
	BaseURL  string `json:"baseUrl"`
	Model    string `json:"model"`
}

// SaveAIConfig POST /api/v1/setup/ai
//
// apiKey 允许为空 —— 表示「暂不配置 AI」，向导仍可继续。
func (h *SetupHandler) SaveAIConfig(c *gin.Context) {
	ok := h.ensureSetupAllowed(c)
	if !ok {
		return
	}

	var req setupAIReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	req.Provider = strings.TrimSpace(strings.ToLower(req.Provider))
	req.APIKey = strings.TrimSpace(req.APIKey)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	req.Model = strings.TrimSpace(req.Model)

	if req.Provider != "" {
		switch req.Provider {
		case "deepseek", "openai", "anthropic":
		default:
			badRequest(c, "不支持的 AI 供应商："+req.Provider, nil)
			return
		}
	}

	if req.Provider != "" && req.APIKey != "" {
		key := "ai_api_key"
		if req.Provider == "anthropic" {
			key = "anthropic_api_key"
		}
		if err := h.repo.SetSetting(c, key, req.APIKey); err != nil {
			serverError(c, "保存 AI 配置失败", err)
			return
		}
	}
	if req.Provider != "" {
		if err := h.repo.SetSetting(c, "ai_provider", req.Provider); err != nil {
			serverError(c, "保存 AI 配置失败", err)
			return
		}
	}
	if req.BaseURL != "" {
		if err := h.repo.SetSetting(c, "ai_base_url", req.BaseURL); err != nil {
			serverError(c, "保存 AI 配置失败", err)
			return
		}
	}
	if req.Model != "" {
		if err := h.repo.SetSetting(c, "ai_model", req.Model); err != nil {
			serverError(c, "保存 AI 配置失败", err)
			return
		}
	}

	// 立即生效（无需重启）
	if h.ai != nil {
		if settings, err := h.repo.AllSettings(c); err == nil {
			h.ai.Reload(settings)
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"provider":     req.Provider,
		"model":        req.Model,
		"baseUrl":      req.BaseURL,
		"apiKeyMasked": maskSecret(req.APIKey),
		"configured":   req.APIKey != "",
	}})
}

// Complete POST /api/v1/setup/complete
//
// 标记引导完成。之后所有 setup 写接口返回 409。
func (h *SetupHandler) Complete(c *gin.Context) {
	ok := h.ensureSetupAllowed(c)
	if !ok {
		return
	}

	marker, err := h.repo.GetSetting(c, setupAdminMarkerKey)
	if err != nil {
		serverError(c, "读取安装标记失败", err)
		return
	}
	if marker == "" {
		badRequest(c, "请先创建管理员账号", nil)
		return
	}

	if err := h.repo.MarkSetupInitialized(c, marker, h.version); err != nil {
		serverError(c, "标记安装完成失败", err)
		return
	}

	writeAudit(c, h.repo, "setup_complete", "system", "setup", `{"version":"`+escapeJSON(h.version)+`"}`)

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"initialized": true,
		"version":     h.version,
		"appUrl":      appBaseURL(c),
	}})
}

// ensureSetupAllowed 校验当前是否允许写入引导数据。
//
// 返回 (false, err) 时已经把错误写进响应。
func (h *SetupHandler) ensureSetupAllowed(c *gin.Context) bool {
	if h.disabled {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{
			"code":    "SETUP_DISABLED",
			"message": "安装引导已通过 SETUP_DISABLED=1 关闭",
		}})
		return false
	}

	state, err := h.repo.GetSetupState(c)
	if err != nil {
		serverError(c, "读取安装状态失败", err)
		return false
	}
	if state.Initialized {
		c.JSON(http.StatusConflict, gin.H{"error": gin.H{
			"code":    "SETUP_ALREADY_DONE",
			"message": "安装引导已完成",
		}})
		return false
	}
	return true
}

// maskSecret 掩码敏感串（仅显示首尾各 4 位）。
func maskSecret(s string) string {
	if s == "" {
		return ""
	}
	if len(s) <= 8 {
		return strings.Repeat("*", len(s))
	}
	return s[:4] + strings.Repeat("*", 6) + s[len(s)-4:]
}

// appBaseURL 根据当前请求推导前端访问地址。
func appBaseURL(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	host := c.Request.Host
	if host == "" {
		host = "localhost:8080"
	}
	return scheme + "://" + host
}
