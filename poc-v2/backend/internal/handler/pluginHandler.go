// M7: 插件系统 handler
//
// 插件系统允许用户注册自定义扩展点，例如：
// - 自定义导出格式
// - 自定义验证规则
// - 自定义模板生成器
//
// GET    /api/v1/plugins            — 列出已注册插件
// POST   /api/v1/plugins            — 注册插件
// DELETE /api/v1/plugins/:id        — 删除插件
// POST   /api/v1/plugins/:id/enable — 启用/禁用插件

package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── 插件数据模型 ─────────────────────────────────────────────────

// Plugin 插件记录
type Plugin struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Version     string    `json:"version"`
	Type        string    `json:"type"` // "export", "validator", "generator", "transform"
	Endpoint    string    `json:"endpoint"` // Webhook URL
	Enabled     bool      `json:"enabled"`
	Config      string    `json:"config,omitempty"` // JSON 配置
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// 内存存储（M7 简化版）
var plugins = make(map[string]*Plugin)
var pluginIDCounter = 0

// ─── Handler 方法 ─────────────────────────────────────────────────

// CreatePluginRequest 创建插件请求
type CreatePluginRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Version     string `json:"version"`
	Type        string `json:"type" binding:"required"`
	Endpoint    string `json:"endpoint" binding:"required"`
	Config      string `json:"config"`
}

// CreatePlugin 注册插件
func (h *Handler) CreatePlugin(c *gin.Context) {
	var req CreatePluginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 验证插件类型
	validTypes := map[string]bool{
		"export":     true,
		"validator":  true,
		"generator":  true,
		"transform":  true,
	}
	if !validTypes[req.Type] {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("未知插件类型: %s", req.Type)})
		return
	}

	if req.Version == "" {
		req.Version = "1.0.0"
	}

	pluginIDCounter++
	p := &Plugin{
		ID:          fmt.Sprintf("plugin_%d", pluginIDCounter),
		UserID:      c.GetString("userID"),
		Name:        req.Name,
		Description: req.Description,
		Version:     req.Version,
		Type:        req.Type,
		Endpoint:    req.Endpoint,
		Enabled:     true,
		Config:      req.Config,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	plugins[p.ID] = p

	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// ListPlugins 列出已注册插件
func (h *Handler) ListPlugins(c *gin.Context) {
	userID := c.GetString("userID")
	var result []*Plugin
	for _, p := range plugins {
		if p.UserID == userID {
			result = append(result, p)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

// DeletePlugin 删除插件
func (h *Handler) DeletePlugin(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("userID")

	p, ok := plugins[id]
	if !ok || p.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "插件不存在"})
		return
	}

	delete(plugins, id)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

// TogglePlugin 启用/禁用插件
func (h *Handler) TogglePlugin(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("userID")

	p, ok := plugins[id]
	if !ok || p.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "插件不存在"})
		return
	}

	p.Enabled = !p.Enabled
	p.UpdatedAt = time.Now()

	c.JSON(http.StatusOK, gin.H{"data": p})
}
