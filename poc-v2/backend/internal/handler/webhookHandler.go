// M6: Webhook 事件通知 handler
//
// POST   /api/v1/webhooks          — 创建 webhook
// GET    /api/v1/webhooks          — 列出当前用户的 webhooks
// DELETE /api/v1/webhooks/:id      — 删除 webhook
// POST   /api/v1/webhooks/:id/test — 发送测试事件

package handler

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── Webhook 数据模型 ─────────────────────────────────────────────

// WebhookSubscription webhook 订阅
type WebhookSubscription struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	URL       string    `json:"url"`
	Events    []string  `json:"events"` // model.created, model.updated, model.deleted, project.created
	Secret    string    `json:"secret,omitempty"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
}

// WebhookEvent webhook 事件
type WebhookEvent struct {
	ID        string      `json:"id"`
	Type      string      `json:"type"`    // model.created, model.updated, etc.
	Timestamp time.Time   `json:"timestamp"`
	Data      interface{} `json:"data"`
}

// 内存存储（M6 简化版；生产环境应持久化到 DB）
var webhooks = make(map[string]*WebhookSubscription)
var webhookIDCounter = 0

// ─── Handler 方法 ─────────────────────────────────────────────────

// CreateWebhookRequest 创建 webhook 请求
type CreateWebhookRequest struct {
	URL    string   `json:"url" binding:"required,url"`
	Events []string `json:"events" binding:"required,min=1"`
	Secret string   `json:"secret"`
}

// CreateWebhook 创建 webhook
func (h *Handler) CreateWebhook(c *gin.Context) {
	var req CreateWebhookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 验证事件类型
	validEvents := map[string]bool{
		"model.created":   true,
		"model.updated":   true,
		"model.deleted":   true,
		"project.created": true,
		"project.updated": true,
		"project.deleted": true,
	}
	for _, e := range req.Events {
		if !validEvents[e] {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("未知事件类型: %s", e)})
			return
		}
	}

	webhookIDCounter++
	wh := &WebhookSubscription{
		ID:        fmt.Sprintf("wh_%d", webhookIDCounter),
		UserID:    c.GetString("user_id"),
		URL:       req.URL,
		Events:    req.Events,
		Secret:    req.Secret,
		Active:    true,
		CreatedAt: time.Now(),
	}
	webhooks[wh.ID] = wh

	c.JSON(http.StatusCreated, gin.H{"data": wh})
}

// ListWebhooks 列出当前用户的 webhooks
func (h *Handler) ListWebhooks(c *gin.Context) {
	userID := c.GetString("user_id")
	var result []*WebhookSubscription
	for _, wh := range webhooks {
		if wh.UserID == userID {
			result = append(result, wh)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

// DeleteWebhook 删除 webhook
func (h *Handler) DeleteWebhook(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	wh, ok := webhooks[id]
	if !ok || wh.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "webhook 不存在"})
		return
	}

	delete(webhooks, id)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

// TestWebhook 发送测试事件
func (h *Handler) TestWebhook(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	wh, ok := webhooks[id]
	if !ok || wh.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "webhook 不存在"})
		return
	}

	event := WebhookEvent{
		ID:        fmt.Sprintf("evt_test_%d", time.Now().UnixNano()),
		Type:      "webhook.test",
		Timestamp: time.Now(),
		Data: map[string]interface{}{
			"message": "这是一个测试事件",
		},
	}

	go deliverWebhook(wh, event)

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"sent":    true,
		"event":   event,
		"webhook": wh.URL,
	}})
}

// ─── 事件触发（供其他 handler 调用）────────────────────────────────

// TriggerWebhookEvent 触发 webhook 事件（异步）
func TriggerWebhookEvent(eventType string, data interface{}) {
	event := WebhookEvent{
		ID:        fmt.Sprintf("evt_%d", time.Now().UnixNano()),
		Type:      eventType,
		Timestamp: time.Now(),
		Data:      data,
	}

	for _, wh := range webhooks {
		if !wh.Active {
			continue
		}
		// 检查是否订阅了此事件
		subscribed := false
		for _, e := range wh.Events {
			if e == eventType {
				subscribed = true
				break
			}
		}
		if !subscribed {
			continue
		}
		go deliverWebhook(wh, event)
	}
}

// deliverWebhook 投递 webhook（带 HMAC 签名）
func deliverWebhook(wh *WebhookSubscription, event WebhookEvent) {
	body, err := json.Marshal(event)
	if err != nil {
		return
	}

	req, err := http.NewRequest("POST", wh.URL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Event", event.Type)
	req.Header.Set("X-Webhook-ID", event.ID)

	// HMAC 签名
	if wh.Secret != "" {
		mac := hmac.New(sha256.New, []byte(wh.Secret))
		mac.Write(body)
		sig := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-Webhook-Signature", "sha256="+sig)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		// 投递失败，可记录日志或重试
		return
	}
	defer resp.Body.Close()

	// 如果连续失败可考虑禁用 webhook（M6 简化版不做）
}
