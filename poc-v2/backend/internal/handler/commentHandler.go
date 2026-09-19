// 模型评论 handler
//
// 在模型元素上添加评论，支持团队协作讨论。
//
// POST   /api/v1/models/:id/comments          — 添加评论
// GET    /api/v1/models/:id/comments          — 获取模型评论
// DELETE /api/v1/models/:id/comments/:commentId — 删除评论

package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── 评论数据模型 ─────────────────────────────────────────────────

// Comment 模型评论
type Comment struct {
	ID        string    `json:"id"`
	ModelID   string    `json:"modelId"`
	UserID    string    `json:"userId"`
	Username  string    `json:"username"`
	ElementID string    `json:"elementId,omitempty"` // 关联的元素 ID（可选）
	Line      int       `json:"line,omitempty"`      // 关联的行号（可选）
	Content   string    `json:"content"`
	Resolved  bool      `json:"resolved"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// 内存存储
var comments = make(map[string][]*Comment) // modelID -> comments
var commentIDCounter = 0

// ─── Handler 方法 ─────────────────────────────────────────────────

// AddCommentRequest 添加评论请求
type AddCommentRequest struct {
	Content   string `json:"content" binding:"required"`
	ElementID string `json:"elementId"`
	Line      int    `json:"line"`
}

// AddComment 添加评论
func (h *Handler) AddComment(c *gin.Context) {
	modelID := c.Param("id")
	userID := c.GetString("user_id")

	var req AddCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 获取用户名
	user, err := h.repo.GetUserByID(c, userID)
	username := "unknown"
	if err == nil && user != nil {
		username = user.Username
	}

	commentIDCounter++
	comment := &Comment{
		ID:        fmt.Sprintf("cmt_%d", commentIDCounter),
		ModelID:   modelID,
		UserID:    userID,
		Username:  username,
		ElementID: req.ElementID,
		Line:      req.Line,
		Content:   req.Content,
		Resolved:  false,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	comments[modelID] = append(comments[modelID], comment)

	c.JSON(http.StatusCreated, gin.H{"data": comment})
}

// ListComments 获取模型评论
func (h *Handler) ListComments(c *gin.Context) {
	modelID := c.Param("id")

	modelComments := comments[modelID]
	if modelComments == nil {
		modelComments = []*Comment{}
	}

	c.JSON(http.StatusOK, gin.H{"data": modelComments})
}

// DeleteComment 删除评论
func (h *Handler) DeleteComment(c *gin.Context) {
	modelID := c.Param("id")
	commentID := c.Param("commentId")
	userID := c.GetString("user_id")

	modelComments := comments[modelID]
	for i, comment := range modelComments {
		if comment.ID == commentID && comment.UserID == userID {
			comments[modelID] = append(modelComments[:i], modelComments[i+1:]...)
			c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "评论不存在"})
}

// ResolveComment 标记评论为已解决
func (h *Handler) ResolveComment(c *gin.Context) {
	modelID := c.Param("id")
	commentID := c.Param("commentId")

	modelComments := comments[modelID]
	for _, comment := range modelComments {
		if comment.ID == commentID {
			comment.Resolved = !comment.Resolved
			comment.UpdatedAt = time.Now()
			c.JSON(http.StatusOK, gin.H{"data": comment})
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "评论不存在"})
}
