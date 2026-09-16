// Package handler — M3 templates endpoint.
//
// GET /api/v1/templates                  列出全部（按 industry 过滤可选）
// GET /api/v1/templates/:id              获取单个（含 Content）
//
// 设计稿：m3-launch-package §1.1 C1 + §2.3 Week 3。
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/templates"
)

// TemplateSummary 是 ListTemplates 返回的精简结构（不含 Content，避免响应过大）。
type TemplateSummary struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Industry     string   `json:"industry"`
	Description  string   `json:"description"`
	PartDefCount int      `json:"part_def_count"`
	Tags         []string `json:"tags"`
}

// ListTemplates GET /templates?industry=automotive
func (h *Handler) ListTemplates(c *gin.Context) {
	industry := c.Query("industry")
	tpls := templates.ByIndustry(industry)

	summaries := make([]TemplateSummary, 0, len(tpls))
	for _, t := range tpls {
		summaries = append(summaries, TemplateSummary{
			ID:           t.ID,
			Name:         t.Name,
			Industry:     t.Industry,
			Description:  t.Description,
			PartDefCount: t.PartDefCount,
			Tags:         t.Tags,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"templates": summaries,
		"count":     len(summaries),
	})
}

// GetTemplate GET /templates/:id（返回完整 Content）
func (h *Handler) GetTemplate(c *gin.Context) {
	id := c.Param("id")
	tpl := templates.ByID(id)
	if tpl == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "template not found",
			"id":    id,
		})
		return
	}

	c.JSON(http.StatusOK, tpl)
}