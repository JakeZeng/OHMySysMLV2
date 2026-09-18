// M6: API Key 认证 handler
//
// 允许外部系统通过 API Key 访问 REST API（替代 JWT）。
//
// POST   /api/v1/api-keys          — 创建 API Key
// GET    /api/v1/api-keys          — 列出当前用户的 API Keys
// DELETE /api/v1/api-keys/:id      — 撤销 API Key

package handler

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── API Key 数据模型 ─────────────────────────────────────────────

// APIKey API Key 记录
type APIKey struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Name      string    `json:"name"`
	Key       string    `json:"key,omitempty"` // 仅创建时返回完整 key
	KeyPrefix string    `json:"keyPrefix"`     // 前缀用于识别（sk_xxxx...xxxx）
	Scopes    []string  `json:"scopes"`        // read, write, admin
	LastUsed  time.Time `json:"lastUsed,omitempty"`
	ExpiresAt time.Time `json:"expiresAt,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// 内存存储（M6 简化版）
var apiKeys = make(map[string]*APIKey)
var apiKeyIDCounter = 0

// ─── Handler 方法 ─────────────────────────────────────────────────

// CreateAPIKeyRequest 创建 API Key 请求
type CreateAPIKeyRequest struct {
	Name   string   `json:"name" binding:"required"`
	Scopes []string `json:"scopes"`
}

// CreateAPIKey 创建 API Key
func (h *Handler) CreateAPIKey(c *gin.Context) {
	var req CreateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 生成随机 key（32 字节 = 64 hex 字符）
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 key 失败"})
		return
	}
	fullKey := "sk_" + hex.EncodeToString(keyBytes)

	apiKeyIDCounter++
	ak := &APIKey{
		ID:        fmt.Sprintf("ak_%d", apiKeyIDCounter),
		UserID:    c.GetString("userID"),
		Name:      req.Name,
		Key:       fullKey,
		KeyPrefix: fullKey[:10] + "...",
		Scopes:    req.Scopes,
		CreatedAt: time.Now(),
	}

	if len(ak.Scopes) == 0 {
		ak.Scopes = []string{"read"}
	}

	apiKeys[ak.ID] = ak

	c.JSON(http.StatusCreated, gin.H{"data": ak})
}

// ListAPIKeys 列出当前用户的 API Keys
func (h *Handler) ListAPIKeys(c *gin.Context) {
	userID := c.GetString("userID")
	var result []*APIKey
	for _, ak := range apiKeys {
		if ak.UserID == userID {
			// 列表不返回完整 key
			safe := *ak
			safe.Key = ""
			result = append(result, &safe)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

// DeleteAPIKey 撤销 API Key
func (h *Handler) DeleteAPIKey(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("userID")

	ak, ok := apiKeys[id]
	if !ok || ak.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "API Key 不存在"})
		return
	}

	delete(apiKeys, id)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

// ─── API Key 中间件 ───────────────────────────────────────────────

// APIKeyAuth API Key 认证中间件
// 支持两种方式：
//   - Header: Authorization: Bearer sk_xxxx
//   - Query:  ?api_key=sk_xxxx
func (h *Handler) APIKeyAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 优先从 header 取
		auth := c.GetHeader("Authorization")
		var key string
		if len(auth) > 7 && auth[:7] == "Bearer " {
			key = auth[7:]
		}
		// fallback: query param
		if key == "" {
			key = c.Query("api_key")
		}

		if key == "" {
			c.Next() // 没有 API Key，走 JWT 认证
			return
		}

		// 查找 key
		for _, ak := range apiKeys {
			if ak.Key == key {
				// 更新最后使用时间
				ak.LastUsed = time.Now()
				// 设置用户信息到 context
				c.Set("userID", ak.UserID)
				c.Set("authMethod", "api_key")
				c.Set("apiScopes", ak.Scopes)
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "无效的 API Key"})
	}
}
