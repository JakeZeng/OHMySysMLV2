// 通知中心 handler
//
// 统一管理模型变更、团队邀请、Webhook 事件等通知。
//
// GET    /api/v1/notifications          — 获取当前用户的通知
// PUT    /api/v1/notifications/:id/read — 标记已读
// PUT    /api/v1/notifications/read-all — 全部标记已读
// GET    /api/v1/notifications/unread   — 获取未读数量

package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── 通知数据模型 ─────────────────────────────────────────────────

// Notification 通知
type Notification struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Type      string    `json:"type"` // model_updated, team_invite, comment, webhook_event, system
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	Link      string    `json:"link,omitempty"` // 相关页面链接
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"createdAt"`
}

// 内存存储
var notifications = make(map[string][]*Notification) // userID -> notifications
var notificationIDCounter = 0

// ─── Handler 方法 ─────────────────────────────────────────────────

// ListNotifications 获取当前用户的通知
func (h *Handler) ListNotifications(c *gin.Context) {
	userID := c.GetString("userID")

	userNotifications := notifications[userID]
	if userNotifications == nil {
		userNotifications = []*Notification{}
	}

	c.JSON(http.StatusOK, gin.H{"data": userNotifications})
}

// MarkAsRead 标记通知为已读
func (h *Handler) MarkAsRead(c *gin.Context) {
	userID := c.GetString("userID")
	notificationID := c.Param("id")

	userNotifications := notifications[userID]
	for _, n := range userNotifications {
		if n.ID == notificationID {
			n.Read = true
			c.JSON(http.StatusOK, gin.H{"data": n})
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "通知不存在"})
}

// MarkAllAsRead 全部标记已读
func (h *Handler) MarkAllAsRead(c *gin.Context) {
	userID := c.GetString("userID")

	userNotifications := notifications[userID]
	for _, n := range userNotifications {
		n.Read = true
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"marked": len(userNotifications)}})
}

// GetUnreadCount 获取未读通知数量
func (h *Handler) GetUnreadCount(c *gin.Context) {
	userID := c.GetString("userID")

	count := 0
	for _, n := range notifications[userID] {
		if !n.Read {
			count++
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"unread": count}})
}

// ─── 通知创建（供其他 handler 调用）────────────────────────────────

// CreateNotification 创建通知
func CreateNotification(userID, notifType, title, message, link string) {
	notificationIDCounter++
	n := &Notification{
		ID:        fmt.Sprintf("notif_%d", notificationIDCounter),
		UserID:    userID,
		Type:      notifType,
		Title:     title,
		Message:   message,
		Link:      link,
		Read:      false,
		CreatedAt: time.Now(),
	}

	notifications[userID] = append(notifications[userID], n)
}
