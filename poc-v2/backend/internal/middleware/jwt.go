// Package middleware 提供 HTTP 中间件（JWT 认证等）。
package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── JWT 配置 ──────────────────────────────────────────────────────────

var jwtSecret []byte

func init() {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "sysmlv2-dev-secret-change-in-production"
	}
	jwtSecret = []byte(secret)
}

// ─── JWT 结构 ──────────────────────────────────────────────────────────

type jwtHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

type jwtPayload struct {
	UserID string `json:"user_id"`
	Exp    int64  `json:"exp"`
	Iat    int64  `json:"iat"`
}

// ─── Token 生成 ──────────────────────────────────────────────────────────

// GenerateToken 生成 JWT token。
func GenerateToken(userID string, expiry time.Duration) (string, error) {
	now := time.Now()
	payload := jwtPayload{
		UserID: userID,
		Exp:    now.Add(expiry).Unix(),
		Iat:    now.Unix(),
	}

	headerBytes, err := json.Marshal(jwtHeader{Alg: "HS256", Typ: "JWT"})
	if err != nil {
		return "", fmt.Errorf("marshal header: %w", err)
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}

	header := base64URLEncode(headerBytes)
	payload64 := base64URLEncode(payloadBytes)
	signingInput := header + "." + payload64

	signature, err := sign(signingInput)
	if err != nil {
		return "", fmt.Errorf("sign: %w", err)
	}

	return signingInput + "." + signature, nil
}

// ─── Token 验证 ──────────────────────────────────────────────────────────

// ValidateToken 验证 JWT token 并返回 payload。
func ValidateToken(tokenString string) (*jwtPayload, error) {
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token format")
	}

	signingInput := parts[0] + "." + parts[1]

	// 验证签名
	expectedSig, err := sign(signingInput)
	if err != nil {
		return nil, fmt.Errorf("sign: %w", err)
	}
	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, errors.New("invalid signature")
	}

	// 解析 payload
	payloadBytes, err := base64URLDecode(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}

	var payload jwtPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, fmt.Errorf("unmarshal payload: %w", err)
	}

	// 检查过期
	if time.Now().Unix() > payload.Exp {
		return nil, errors.New("token expired")
	}

	return &payload, nil
}

// ─── Gin 中间件 ──────────────────────────────────────────────────────────

// AuthRequired 返回 JWT 认证中间件。
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{
				"code":    "E_UNAUTHORIZED",
				"message": "缺少认证信息",
			}})
			c.Abort()
			return
		}

		// 支持 "Bearer <token>" 格式
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{
				"code":    "E_UNAUTHORIZED",
				"message": "认证格式无效，应为 Bearer <token>",
			}})
			c.Abort()
			return
		}

		payload, err := ValidateToken(parts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{
				"code":    "E_UNAUTHORIZED",
				"message": "认证信息无效: " + err.Error(),
			}})
			c.Abort()
			return
		}

		// 将 user_id 注入到 context
		c.Set("user_id", payload.UserID)
		c.Next()
	}
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────

func sign(input string) (string, error) {
	mac := hmac.New(sha256.New, jwtSecret)
	_, err := mac.Write([]byte(input))
	if err != nil {
		return "", err
	}
	return base64URLEncode(mac.Sum(nil)), nil
}

func base64URLEncode(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

func base64URLDecode(s string) ([]byte, error) {
	// 补齐 padding
	switch len(s) % 4 {
	case 2:
		s += "=="
	case 3:
		s += "="
	}
	return base64.URLEncoding.DecodeString(s)
}
