// SSE 事件流 handler (M13)
//
// 路由：
//   GET /api/v1/events/stream?scope=package:xxx  订阅 scope 事件
//
// 协议：
//   text/event-stream；每条事件一行 `data: {json}\n\n`。
//   15s 一次注释行（`: keepalive`）保活。
//   客户端断开自动清理订阅。
//
// 事件类型：
//   - hello           连接建立
//   - presence        在线用户列表更新
//   - lock_changed    锁状态变化
//   - lock_released   锁释放
//   - content_updated 内容更新（由 UpdatePackage/View 触发）
//   - comment_added   新评论
//   - comment_resolved 评论状态切换
//   - comment_removed 评论删除

package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/hub"
	"github.com/sysmlv2/mbse-backend/internal/model"
)

// StreamEvents SSE 事件流。
func (h *Handler) StreamEvents(c *gin.Context) {
	if h.hub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{
			"code":    "E_HUB_DISABLED",
			"message": "事件广播未启用",
		}})
		return
	}
	scope := c.Query("scope")
	if scope == "" {
		badRequest(c, "scope 必填", nil)
		return
	}
	if !h.canAccessScope(c, scope) {
		return
	}

	// 设置 SSE headers
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no") // 禁用 nginx 缓冲
	c.Writer.WriteHeader(http.StatusOK)

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		serverError(c, "streaming unsupported", nil)
		return
	}

	// 订阅
	sub := h.hub.Subscribe(scope, 32)
	defer sub.Unsubscribe()

	// 发送 hello
	userID := c.GetString("user_id")
	_ = writeSSE(c.Writer, "hello", map[string]any{
		"scope":  scope,
		"ts":     time.Now().UTC().Format(time.RFC3339Nano),
		"userId": userID,
	})
	flusher.Flush()

	// 立即发一次 presence 快照
	h.publishPresence(scope, userID)

	// keepalive ticker
	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	// 客户端断开检测（通过 Request.Context 自动检测）
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-keepalive.C:
			_, _ = c.Writer.Write([]byte(": keepalive\n\n"))
			flusher.Flush()
		case ev, open := <-sub.Channel():
			if !open {
				return
			}
			if err := writeSSE(c.Writer, ev.Type, ev.Data); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// writeSSE 把事件序列化为 SSE data 行。
func writeSSE(w http.ResponseWriter, eventType string, data any) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, payload)
	return err
}

// wrapContextDone 兼容旧 Go 版本的 CloseNotify。
//
// 当前 Go 1.16+ 直接用 Request.Context().Done() 即可；本 helper 保留供将来使用。
func wrapContextDone(c *gin.Context) <-chan struct{} {
	out := make(chan struct{})
	go func() {
		<-c.Request.Context().Done()
		close(out)
	}()
	return out
}

// ─── 跨 handler 广播辅助 ────────────────────────────────────────

// PublishContentUpdated 在 package/view 更新后广播。
func (h *Handler) PublishContentUpdated(scope, byUserID, byUsername string, newVersion int) {
	if h.hub == nil {
		return
	}
	h.hub.Publish(scope, hub.Event{
		Type: "content_updated",
		Data: map[string]any{
			"scope":      scope,
			"by":         map[string]any{"userId": byUserID, "username": byUsername},
			"newVersion": newVersion,
			"ts":         time.Now().UTC().Format(time.RFC3339Nano),
		},
	})
}

// PublishScopeFromEntityKind 工具：把 (kind, id) 转 scope。
func PublishScopeFromEntityKind(kind, id string) string {
	return model.MakeScope(kind, id)
}
