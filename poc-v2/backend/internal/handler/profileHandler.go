// M5: Profile 导出/导入 handler
//
// POST /api/v1/profiles/export  — 导出项目 Profile JSON
// POST /api/v1/profiles/import  — 导入 Profile JSON 到项目

package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── Profile 导出 ─────────────────────────────────────────────────

// ProfileExportRequest 导出请求
type ProfileExportRequest struct {
	ProjectID string `json:"projectId" binding:"required"`
	Name      string `json:"name" binding:"required"`
	Version   string `json:"version"`
}

// ProfileData 导出的 Profile 结构
type ProfileData struct {
	Name        string            `json:"name"`
	Version     string            `json:"version"`
	Description string            `json:"description,omitempty"`
	Stereotypes []StereotypeEntry `json:"stereotypes"`
	Templates   []TemplateEntry   `json:"templates"`
}

// StereotypeEntry Stereotype 条目
type StereotypeEntry struct {
	Name       string            `json:"name"`
	Metaclass  string            `json:"metaclass"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

// TemplateEntry 模板条目
type TemplateEntry struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// ExportProfile 导出项目 Profile
func (h *Handler) ExportProfile(c *gin.Context) {
	var req ProfileExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 获取项目下的模型
	models, err := h.repo.ListModelsByProject(c, req.ProjectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取模型失败"})
		return
	}

	// 构建 Profile
	profile := ProfileData{
		Name:    req.Name,
		Version: req.Version,
	}

	if profile.Version == "" {
		profile.Version = "1.0"
	}

	// 从模型中提取模板
	for _, m := range models {
		profile.Templates = append(profile.Templates, TemplateEntry{
			Name:    m.Name,
			Content: m.Content,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": profile})
}

// ImportProfileRequest 导入请求
type ImportProfileRequest struct {
	ProjectID string      `json:"projectId" binding:"required"`
	Profile   ProfileData `json:"profile" binding:"required"`
}

// ImportProfile 导入 Profile 到项目
func (h *Handler) ImportProfile(c *gin.Context) {
	var req ImportProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 逐个导入模板为模型
	imported := 0
	for _, tpl := range req.Profile.Templates {
		m := &model.Model{
			ID:        fmt.Sprintf("profile-%d", imported),
			ProjectID: req.ProjectID,
			Name:      tpl.Name,
			Content:   tpl.Content,
			Version:   1,
		}
		if err := h.repo.CreateModel(c, m); err != nil {
			continue // 跳过失败的
		}
		imported++
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"imported": imported,
			"total":    len(req.Profile.Templates),
			"profile":  req.Profile.Name,
		},
	})
}
