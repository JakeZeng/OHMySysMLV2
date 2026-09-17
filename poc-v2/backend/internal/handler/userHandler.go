// Package handler — 用户搜索端点（M4 W3 补充）。
//
//   - GET /api/v1/users/search?q=<prefix>&limit=<n>
//
// 用途：项目分享、团队邀请等场景下按 username / email 前缀解析 userId。
package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// UserHandler 用户查询端点。
type UserHandler struct {
	repo *repository.SQLiteRepository
}

// NewUserHandler 构造 UserHandler。
func NewUserHandler(repo *repository.SQLiteRepository) *UserHandler {
	return &UserHandler{repo: repo}
}

// SearchUsers 按 prefix 模糊匹配 username 或 email。
//
//	q    必填，长度 >= 1
//	limit 可选，默认 10，上限 50
//
// 响应：`{ data: { users: [{id, username, email, createdAt}] } }`
func (h *UserHandler) SearchUsers(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		badRequest(c, "查询参数 q 不能为空", nil)
		return
	}
	limit := 10
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}

	users, err := h.repo.SearchUsers(c, q, limit)
	if err != nil {
		serverError(c, "查询用户失败", err)
		return
	}
	if users == nil {
		users = []*model.User{}
	}

	// 投影：去掉 password_hash 等敏感字段
	type userOut struct {
		ID        string `json:"id"`
		Username  string `json:"username"`
		Email     string `json:"email"`
		CreatedAt string `json:"createdAt"`
	}
	out := make([]userOut, 0, len(users))
	for _, u := range users {
		out = append(out, userOut{
			ID:        u.ID,
			Username:  u.Username,
			Email:     u.Email,
			CreatedAt: u.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"users": out}})
}