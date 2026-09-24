// 实时协同 — 在线状态 handler (M13 重写：DB 持久化 + scope 通用化)
//
// 路由：
//   POST   /api/v1/presence/heartbeat       上报心跳
//   GET    /api/v1/presence?scope=...       列出 scope 下的在线用户
//   DELETE /api/v1/presence?scope=...       离开 scope
//
// M13 变更：
//   - 从内存 map → SQLite 表 presence（进程重启不丢失）
//   - URL 从 /:modelId 改为 ?scope=（兼容 package:xxx / view:xxx / model:xxx）
//   - 颜色由后端按 userID hash 分配（保证同用户跨 tab 同色）
//   - 增加 contentHash 字段（前端周期性上报，标记"别人正在编辑"）
//   - 通过 hub.Publish 广播 presence 变化给 SSE 订阅者

package handler

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/hub"
	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── 在线状态数据模型 ─────────────────────────────────────────────

// HeartbeatRequest 心跳请求。
type HeartbeatRequest struct {
	// M13：scope 替换 modelId（必填），如 "package:pkg_abc" / "view:view_xyz"。
	// 兼容：若 client 仍传 modelId，服务端当作 "model:<modelId>"。
	Scope        string          `json:"scope"`
	ModelID      string          `json:"modelId"` // 兼容旧字段
	Cursor       *CursorPosition `json:"cursor"`
	Selection    *SelectionRange `json:"selection"`
	ContentHash  string          `json:"contentHash"`
}

// PresenceResponse 单条 presence 信息。
type PresenceResponse struct {
	UserID      string    `json:"userId"`
	Username    string    `json:"username"`
	Color       string    `json:"color"`
	Cursor      *CursorPosition `json:"cursor,omitempty"`
	Selection   *SelectionRange `json:"selection,omitempty"`
	ContentHash string    `json:"contentHash"`
	LastSeen    time.Time `json:"lastSeen"`
}

// CursorPosition 光标位置（前端上报）。
type CursorPosition struct {
	Line   int `json:"line"`
	Column int `json:"column"`
}

// SelectionRange 选区范围（前端上报）。
type SelectionRange struct {
	StartLine int `json:"startLine"`
	StartCol  int `json:"startCol"`
	EndLine   int `json:"endLine"`
	EndCol    int `json:"endCol"`
}

// 颜色池（用于 hash → 颜色分配）。
var presenceColors = []string{
	"#3b82f6", "#ef4444", "#10b981", "#f59e0b",
	"#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
}

// colorForUser 根据 userID 稳定分配颜色（同用户跨 tab 同色）。
func colorForUser(userID string) string {
	sum := sha256.Sum256([]byte("presence-color:" + userID))
	n := binary.BigEndian.Uint32(sum[:4])
	return presenceColors[int(n)%len(presenceColors)]
}

// resolveScope 把请求里的 scope / modelId 统一成完整 scope。
func resolveScope(reqScope, modelID string) string {
	if reqScope != "" {
		return reqScope
	}
	if modelID != "" {
		return model.MakeScope(model.ScopeKindModel, modelID)
	}
	return ""
}

// ─── Handler 方法 ─────────────────────────────────────────────────

// Heartbeat 上报心跳。
func (h *Handler) Heartbeat(c *gin.Context) {
	var req HeartbeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	scope := resolveScope(req.Scope, req.ModelID)
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

	presence := &model.Presence{
		Scope:       scope,
		UserID:      userID,
		Username:    username,
		Color:       colorForUser(userID),
		ContentHash: req.ContentHash,
	}
	if req.Cursor != nil {
		l, col := req.Cursor.Line, req.Cursor.Column
		presence.CursorLine = &l
		presence.CursorCol = &col
	}
	if req.Selection != nil {
		sl, sc, el, ec := req.Selection.StartLine, req.Selection.StartCol, req.Selection.EndLine, req.Selection.EndCol
		presence.SelStartLine = &sl
		presence.SelStartCol = &sc
		presence.SelEndLine = &el
		presence.SelEndCol = &ec
	}

	if err := h.repo.UpsertPresence(c, presence); err != nil {
		serverError(c, "保存在线状态失败", err)
		return
	}

	// 广播 presence 更新（仅给同 scope 的订阅者；发起方不需要 — 但为简单起见广播）
	h.publishPresence(scope, userID)

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"scope": scope,
		"ok":    true,
	}})
}

// GetPresence 列出 scope 下的在线用户（排除自己）。
func (h *Handler) GetPresence(c *gin.Context) {
	scope := c.Query("scope")
	if scope == "" {
		// 兼容旧路由：/presence/:modelId
		scope = model.MakeScope(model.ScopeKindModel, c.Param("modelId"))
	}
	if scope == "" {
		badRequest(c, "scope 必填", nil)
		return
	}
	userID := c.GetString("user_id")

	ttlStr := c.DefaultQuery("ttl", "30")
	ttl, _ := strconv.Atoi(ttlStr)
	if ttl <= 0 {
		ttl = 30
	}

	records, err := h.repo.ListPresence(c, scope, userID, ttl)
	if err != nil {
		serverError(c, "查询在线用户失败", err)
		return
	}

	resp := make([]PresenceResponse, 0, len(records))
	for _, p := range records {
		r := PresenceResponse{
			UserID:      p.UserID,
			Username:    p.Username,
			Color:       p.Color,
			ContentHash: p.ContentHash,
			LastSeen:    p.LastSeen,
		}
		if p.CursorLine != nil && p.CursorCol != nil {
			r.Cursor = &CursorPosition{Line: *p.CursorLine, Column: *p.CursorCol}
		}
		if p.SelStartLine != nil && p.SelStartCol != nil && p.SelEndLine != nil && p.SelEndCol != nil {
			r.Selection = &SelectionRange{
				StartLine: *p.SelStartLine, StartCol: *p.SelStartCol,
				EndLine: *p.SelEndLine, EndCol: *p.SelEndCol,
			}
		}
		resp = append(resp, r)
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// LeavePresence 离开 scope。
func (h *Handler) LeavePresence(c *gin.Context) {
	scope := c.Query("scope")
	if scope == "" {
		scope = model.MakeScope(model.ScopeKindModel, c.Param("modelId"))
	}
	if scope == "" {
		badRequest(c, "scope 必填", nil)
		return
	}
	userID := c.GetString("user_id")
	if err := h.repo.DeletePresence(c, scope, userID); err != nil {
		serverError(c, "清理在线状态失败", err)
		return
	}
	h.publishPresence(scope, userID)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"left": true}})
}

// publishPresence 把当前 presence 列表广播给 scope 订阅者。
func (h *Handler) publishPresence(scope, excludeUserID string) {
	if h.hub == nil {
		return
	}
	// 异步获取（避免阻塞调用方）
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		records, err := h.repo.ListPresence(ctx, scope, excludeUserID, 30)
		if err != nil {
			return
		}
		users := make([]PresenceResponse, 0, len(records))
		for _, p := range records {
			r := PresenceResponse{
				UserID: p.UserID, Username: p.Username,
				Color: p.Color, ContentHash: p.ContentHash,
				LastSeen: p.LastSeen,
			}
			if p.CursorLine != nil && p.CursorCol != nil {
				r.Cursor = &CursorPosition{Line: *p.CursorLine, Column: *p.CursorCol}
			}
			if p.SelStartLine != nil && p.SelStartCol != nil && p.SelEndLine != nil && p.SelEndCol != nil {
				r.Selection = &SelectionRange{
					StartLine: *p.SelStartLine, StartCol: *p.SelStartCol,
					EndLine: *p.SelEndLine, EndCol: *p.SelEndCol,
				}
			}
			users = append(users, r)
		}
		h.hub.Publish(scope, hub.Event{
			Type: "presence",
			Data: gin.H{"scope": scope, "users": users},
		})
	}()
}
