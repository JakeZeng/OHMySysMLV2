// 实时协同 — 在线状态 handler
//
// 基于 HTTP 轮询（M7+ 可升级为 WebSocket）。
//
// POST /api/v1/presence/heartbeat — 发送心跳（当前位置信息）
// GET  /api/v1/presence/:modelId  — 获取模型的在线用户列表

package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── 在线状态数据模型 ─────────────────────────────────────────────

// UserPresence 用户在线状态
type UserPresence struct {
	UserID    string    `json:"userId"`
	Username  string    `json:"username"`
	ModelID   string    `json:"modelId"`
	Cursor    *CursorPosition `json:"cursor,omitempty"`
	Selection *SelectionRange `json:"selection,omitempty"`
	Color     string    `json:"color"` // 分配的颜色标识
	LastSeen  time.Time `json:"lastSeen"`
}

// CursorPosition 光标位置
type CursorPosition struct {
	Line   int `json:"line"`
	Column int `json:"column"`
}

// SelectionRange 选区范围
type SelectionRange struct {
	StartLine int `json:"startLine"`
	StartCol  int `json:"startCol"`
	EndLine   int `json:"endLine"`
	EndCol    int `json:"endCol"`
}

// 内存存储
var presences = make(map[string]map[string]*UserPresence) // modelID -> userID -> presence

// 预定义颜色（用于区分不同用户）
var userColors = []string{
	"#3b82f6", // blue
	"#ef4444", // red
	"#10b981", // green
	"#f59e0b", // amber
	"#8b5cf6", // violet
	"#ec4899", // pink
	"#06b6d4", // cyan
	"#f97316", // orange
}

var colorIndex = 0

// ─── Handler 方法 ─────────────────────────────────────────────────

// HeartbeatRequest 心跳请求
type HeartbeatRequest struct {
	ModelID   string          `json:"modelId" binding:"required"`
	Cursor    *CursorPosition `json:"cursor"`
	Selection *SelectionRange `json:"selection"`
}

// Heartbeat 发送心跳
func (h *Handler) Heartbeat(c *gin.Context) {
	var req HeartbeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("userID")

	// 获取用户名
	user, err := h.repo.GetUserByID(c, userID)
	username := "unknown"
	if err == nil && user != nil {
		username = user.Username
	}

	// 分配颜色
	if presences[req.ModelID] == nil {
		presences[req.ModelID] = make(map[string]*UserPresence)
	}

	p := presences[req.ModelID][userID]
	if p == nil {
		p = &UserPresence{
			UserID:   userID,
			Username: username,
			ModelID:  req.ModelID,
			Color:    userColors[colorIndex%len(userColors)],
		}
		colorIndex++
		presences[req.ModelID][userID] = p
	}

	p.Cursor = req.Cursor
	p.Selection = req.Selection
	p.LastSeen = time.Now()

	c.JSON(http.StatusOK, gin.H{"data": p})
}

// GetPresence 获取模型的在线用户列表
func (h *Handler) GetPresence(c *gin.Context) {
	modelID := c.Param("modelId")
	userID := c.GetString("userID")

	modelPresences := presences[modelID]
	var result []*UserPresence

	now := time.Now()
	for uid, p := range modelPresences {
		// 清理超过 30 秒未心跳的用户
		if now.Sub(p.LastSeen) > 30*time.Second {
			delete(modelPresences, uid)
			continue
		}
		// 不返回自己
		if uid != userID {
			result = append(result, p)
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// LeavePresence 离开模型（清理状态）
func (h *Handler) LeavePresence(c *gin.Context) {
	modelID := c.Param("modelId")
	userID := c.GetString("userID")

	if presences[modelID] != nil {
		delete(presences[modelID], userID)
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"left": true}})
}
