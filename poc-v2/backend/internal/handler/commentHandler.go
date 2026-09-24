// 评论 handler (M13 重写：DB 持久化 + scope 通用化)
//
// 路由：
//   POST   /api/v1/comments                  新增评论（body 带 scope）
//   GET    /api/v1/comments?scope=...        列出 scope 下评论
//   DELETE /api/v1/comments/:id?scope=...    删除（仅作者）
//   PUT    /api/v1/comments/:id/resolve      切换 resolved（任何有权限用户）
//
// M13 变更：
//   - 从内存 map → SQLite 表 comments
//   - URL 从 /:modelId/comments → 统一 /comments?scope=
//   - 通过 hub.Publish 广播评论变化给 SSE 订阅者
//   - 保留旧路由 /models/:id/comments/:cid/... 兼容层（标 deprecated）

package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/sysmlv2/mbse-backend/internal/hub"
	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── 请求 / 响应模型 ──────────────────────────────────────────────

// AddCommentRequest 新增评论请求。
type AddCommentRequest struct {
	// M13：scope 通用化（package:<id> / view:<id> / model:<id>）。
	// 兼容：scope 为空时使用 modelId 字段。
	Scope     string `json:"scope"`
	ModelID   string `json:"modelId"`
	ElementID string `json:"elementId"`
	Line      int    `json:"line"`
	Content   string `json:"content" binding:"required"`
}

// ─── Handler 方法 ─────────────────────────────────────────────────

// AddComment 添加评论。
func (h *Handler) AddComment(c *gin.Context) {
	var req AddCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	scope := req.Scope
	if scope == "" && req.ModelID != "" {
		scope = model.MakeScope(model.ScopeKindModel, req.ModelID)
	}
	// 兼容旧路由 /models/:id/comments
	if scope == "" {
		scope = model.MakeScope(model.ScopeKindModel, c.Param("id"))
	}
	if scope == "" {
		badRequest(c, "scope 或 modelId 必填", nil)
		return
	}

	userID := c.GetString("user_id")
	user, err := h.repo.GetUserByID(c, userID)
	username := userID
	if err == nil && user != nil {
		username = user.Username
	}

	now := time.Now().UTC()
	cmt := &model.Comment{
		ID:        "cmt_" + uuid.NewString()[:8],
		Scope:     scope,
		UserID:    userID,
		Username:  username,
		ElementID: req.ElementID,
		Line:      req.Line,
		Content:   req.Content,
		Resolved:  false,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := h.repo.AddComment(c, cmt); err != nil {
		serverError(c, "添加评论失败", err)
		return
	}

	// 权限校验（仅项目成员 / 协作者可见评论）
	if !h.canAccessScope(c, scope) {
		// 撤销（DB 不留痕）
		_, _ = h.repo.DeleteComment(c, scope, cmt.ID, userID)
		badRequest(c, "无权评论此资源", nil)
		return
	}

	// 广播
	if h.hub != nil {
		h.hub.Publish(scope, hub.Event{
			Type: "comment_added",
			Data: gin.H{"scope": scope, "comment": cmt},
		})
	}

	c.JSON(http.StatusCreated, gin.H{"data": cmt})
}

// ListComments 列出 scope 下评论。
func (h *Handler) ListComments(c *gin.Context) {
	scope := c.Query("scope")
	if scope == "" {
		scope = model.MakeScope(model.ScopeKindModel, c.Param("id"))
	}
	if scope == "" {
		badRequest(c, "scope 必填", nil)
		return
	}
	if !h.canAccessScope(c, scope) {
		return // 已在 helper 内 401
	}
	out, err := h.repo.ListComments(c, scope)
	if err != nil {
		serverError(c, "查询评论失败", err)
		return
	}
	if out == nil {
		out = []*model.Comment{}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// DeleteComment 删除评论（仅作者）。
func (h *Handler) DeleteComment(c *gin.Context) {
	commentID := c.Param("id")
	if commentID == "" {
		commentID = c.Param("commentId")
	}
	scope := c.Query("scope")
	if scope == "" {
		scope = model.MakeScope(model.ScopeKindModel, c.Param("modelId"))
	}
	if scope == "" {
		badRequest(c, "scope 必填", nil)
		return
	}
	userID := c.GetString("user_id")
	ok, err := h.repo.DeleteComment(c, scope, commentID, userID)
	if err != nil {
		serverError(c, "删除评论失败", err)
		return
	}
	if !ok {
		notFound(c, "评论不存在或无权删除")
		return
	}
	if h.hub != nil {
		h.hub.Publish(scope, hub.Event{
			Type: "comment_removed",
			Data: gin.H{"scope": scope, "commentId": commentID},
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

// ResolveComment 切换 resolved 状态。
func (h *Handler) ResolveComment(c *gin.Context) {
	commentID := c.Param("id")
	if commentID == "" {
		commentID = c.Param("commentId")
	}
	scope := c.Query("scope")
	if scope == "" {
		scope = model.MakeScope(model.ScopeKindModel, c.Param("modelId"))
	}
	if scope == "" {
		badRequest(c, "scope 必填", nil)
		return
	}
	if !h.canAccessScope(c, scope) {
		return
	}
	cmt, err := h.repo.ToggleCommentResolved(c, scope, commentID)
	if err != nil {
		serverError(c, "切换评论状态失败", err)
		return
	}
	if h.hub != nil {
		h.hub.Publish(scope, hub.Event{
			Type: "comment_resolved",
			Data: gin.H{"scope": scope, "comment": cmt},
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": cmt})
}

// canAccessScope 校验当前用户是否对 scope 有访问权限。
//
// 返回值：true = 有权限；false = 无权限（已通过 gin 写 401）。
//
// loadAccessible* 的第三个返回值为 Permission（0 表示无权限）；>= PermRead 即视为可读。
func (h *Handler) canAccessScope(c *gin.Context, scope string) bool {
	kind, id := model.ParseScope(scope)
	switch kind {
	case model.ScopeKindPackage:
		_, _, perm, err := loadAccessiblePackage(c, h.repo, id, PermRead)
		if err != nil || perm < PermRead {
			return false
		}
		return true
	case model.ScopeKindView:
		_, _, perm, err := loadAccessibleView(c, h.repo, id, PermRead)
		if err != nil || perm < PermRead {
			return false
		}
		return true
	case model.ScopeKindModel:
		_, _, perm, err := loadAccessibleModel(c, h.repo, id, PermRead)
		if err != nil || perm < PermRead {
			return false
		}
		return true
	default:
		badRequest(c, "未知 scope 类型: "+kind, nil)
		return false
	}
}
