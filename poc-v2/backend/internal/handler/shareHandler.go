// Package handler — M4 W3 项目分享（直分享 + 链接 + 公开接收）。
package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// ShareHandler 处理项目级分享路由 + 公开接收端点。
type ShareHandler struct {
	repo *repository.SQLiteRepository
}

// NewShareHandler 构造 ShareHandler。
func NewShareHandler(repo *repository.SQLiteRepository) *ShareHandler {
	return &ShareHandler{repo: repo}
}

// ─── 项目内直分享 /api/v1/projects/:id/shares/* ─────────────────────

// requireProjectAdmin 要求当前用户是 project admin（owner 自动 admin；team admin 不能管分享）。
// 复用 loadAccessibleProject(admin)，owner 永远 admin；非 owner 即便 team admin 也无权直分享。
func (h *ShareHandler) requireProjectAdmin(c *gin.Context, projectID string) (*model.Project, bool) {
	p, _, err := loadAccessibleProject(c, h.repo, projectID, PermAdmin)
	if err != nil || p == nil {
		return nil, false
	}
	return p, true
}

type addShareReq struct {
	UserID     string `json:"userId" binding:"required"`
	Permission string `json:"permission" binding:"required,oneof=read write admin"`
}

func (h *ShareHandler) AddShare(c *gin.Context) {
	projectID := c.Param("id")
	currentUserID := c.GetString("user_id")
	if _, ok := h.requireProjectAdmin(c, projectID); !ok {
		return
	}
	var req addShareReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	// 不能把 owner 加进 share 表
	project, _ := h.repo.GetProject(c, projectID)
	if project != nil && project.OwnerID == req.UserID {
		badRequest(c, "不能把 owner 加入分享（已是 admin）", nil)
		return
	}
	if err := h.repo.ShareProjectWithUser(c, projectID, req.UserID, req.Permission, currentUserID); err != nil {
		serverError(c, "分享失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionShare, model.AuditTargetShare,
		projectID+"/"+req.UserID,
		`{"permission":"`+req.Permission+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"projectId":  projectID,
		"userId":     req.UserID,
		"permission": req.Permission,
	}})
}

func (h *ShareHandler) ListShares(c *gin.Context) {
	projectID := c.Param("id")
	if _, ok := h.requireProjectAdmin(c, projectID); !ok {
		return
	}
	shares, err := h.repo.ListProjectShares(c, projectID)
	if err != nil {
		serverError(c, "列出分享失败", err)
		return
	}
	if shares == nil {
		shares = []*model.ProjectShare{}
	}
	c.JSON(http.StatusOK, gin.H{"data": shares})
}

func (h *ShareHandler) RemoveShare(c *gin.Context) {
	projectID := c.Param("id")
	userID := c.Param("userId")
	if _, ok := h.requireProjectAdmin(c, projectID); !ok {
		return
	}
	if err := h.repo.RevokeProjectShare(c, projectID, userID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "分享不存在")
			return
		}
		serverError(c, "撤销失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionUnshare, model.AuditTargetShare,
		projectID+"/"+userID, "")
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// ─── 项目内链接 /api/v1/projects/:id/links/* ────────────────────────

type createLinkReq struct {
	Permission string `json:"permission" binding:"required,oneof=read write"`
	// ExpiresInHours 可选；不传/0 表示不过期
	ExpiresInHours int `json:"expiresInHours"`
}

func (h *ShareHandler) CreateLink(c *gin.Context) {
	projectID := c.Param("id")
	currentUserID := c.GetString("user_id")
	if _, ok := h.requireProjectAdmin(c, projectID); !ok {
		return
	}
	var req createLinkReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	var expiresAt *time.Time
	if req.ExpiresInHours > 0 {
		t := time.Now().UTC().Add(time.Duration(req.ExpiresInHours) * time.Hour)
		expiresAt = &t
	}
	sl, token, err := h.repo.NewShareLink(c, projectID, req.Permission, currentUserID, expiresAt)
	if err != nil {
		serverError(c, "创建链接失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionLinkCreate, model.AuditTargetLink,
		sl.ID,
		`{"permission":"`+req.Permission+`","expires_in_hours":`+itoa10(req.ExpiresInHours)+`}`)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"link":    sl,
		"token":   token,
		"message": "请保存此 token，刷新页面后无法再查看。",
	}})
}

func (h *ShareHandler) ListLinks(c *gin.Context) {
	projectID := c.Param("id")
	if _, ok := h.requireProjectAdmin(c, projectID); !ok {
		return
	}
	links, err := h.repo.ListProjectShareLinks(c, projectID)
	if err != nil {
		serverError(c, "列出链接失败", err)
		return
	}
	if links == nil {
		links = []*model.ShareLink{}
	}
	c.JSON(http.StatusOK, gin.H{"data": links})
}

func (h *ShareHandler) RevokeLink(c *gin.Context) {
	projectID := c.Param("id")
	linkID := c.Param("linkId")
	if _, ok := h.requireProjectAdmin(c, projectID); !ok {
		return
	}
	if err := h.repo.RevokeShareLink(c, linkID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "链接不存在")
			return
		}
		serverError(c, "撤销失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionLinkRevoke, model.AuditTargetLink,
		linkID, "")
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// ─── 公开端点 /api/v1/shared/:token ──────────────────────────────────

// GetSharedProject 公开端点：持 token 获取项目只读视图（+ model 列表只读）。
// 任何失效情况一律返回 404 + 通用 message（不区分 not-found/revoked/expired）。
func (h *ShareHandler) GetSharedProject(c *gin.Context) {
	token := c.Param("token")
	res, err := resolveShareToken(h.repo, token)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "链接无效或已失效")
			return
		}
		serverError(c, "解析链接失败", err)
		return
	}
	// 计数（best-effort，失败不阻塞响应）
	if err := h.repo.IncrementShareLinkView(c, res.LinkID); err != nil {
		// 仅日志，不影响主流程
		c.Header("X-Share-View-Error", "1")
	}
	project, err := h.repo.GetProject(c, res.ProjectID)
	if err != nil {
		notFound(c, "链接无效或已失效")
		return
	}
	models, _ := h.repo.ListModelsByProject(c, res.ProjectID)
	if models == nil {
		models = []*model.Model{}
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"project":   project,
		"models":    models,
		"permission": permissionString(res.Permission),
	}})
}

// itoa10 — 简单 10 进制转字符串（避免 strconv 导入时的多余依赖）。
func itoa10(n int) string {
	if n == 0 {
		return "0"
	}
	negative := n < 0
	if negative {
		n = -n
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if negative {
		return "-" + string(digits)
	}
	return string(digits)
}

// silence unused
var _ = itoa10

func permissionString(p Permission) string {
	switch p {
	case PermRead:
		return "read"
	case PermWrite:
		return "write"
	case PermAdmin:
		return "admin"
	}
	return "none"
}
