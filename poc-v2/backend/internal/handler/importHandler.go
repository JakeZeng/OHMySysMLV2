// M6: 外部模型导入 handler
//
// POST /api/v1/import/papyrus — 导入 Papyrus/SysML v1 XML
// POST /api/v1/import/capella — 导入 Capella JSON
//
// 导入流程：上传文件 → 解析 → 转换为 SysML v2 AST → 序列化为文本 → 创建模型

package handler

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── Papyrus XML 解析 ─────────────────────────────────────────────

// PapyrusModel Papyrus UML/SysML v1 XML 模型
type PapyrusModel struct {
	XMLName  xml.Name         `xml:"uml:Model"`
	Name     string           `xml:"name,attr"`
	Packages []PapyrusPackage `xml:"packagedElement"`
}

// PapyrusPackage 包
type PapyrusPackage struct {
	Type       string           `xml:"xmi:type,attr"`
	Name       string           `xml:"name,attr"`
	Elements   []PapyrusElement `xml:"packagedElement"`
}

// PapyrusElement 元素
type PapyrusElement struct {
	Type   string `xml:"xmi:type,attr"`
	Name   string `xml:"name,attr"`
	ID     string `xml:"xmi:id,attr"`
	IsLeaf bool   `xml:"isLeaf,attr"`
}

// ─── Capella JSON 解析 ─────────────────────────────────────────────

// CapellaModel Capella JSON 模型
type CapellaModel struct {
	Name     string          `json:"name"`
	Elements []CapellaElement `json:"elements"`
}

// CapellaElement 元素
type CapellaElement struct {
	Type string `json:"type"`
	Name string `json:"name"`
	ID   string `json:"id"`
}

// ─── ImportPapyrus 导入 Papyrus XML ───────────────────────────────

func (h *Handler) ImportPapyrus(c *gin.Context) {
	projectID := c.PostForm("projectId")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 projectId"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少文件"})
		return
	}
	defer file.Close()

	// 读取文件内容
	content, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}

	// 解析 XML
	var papyrus PapyrusModel
	if err := xml.Unmarshal(content, &papyrus); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("XML 解析失败: %v", err)})
		return
	}

	// 转换为 SysML v2 文本
	sysmlText := convertPapyrusToSysMLv2(papyrus)

	// 创建模型
	m := &model.Model{
		Name:     strings.TrimSuffix(header.Filename, ".xml"),
		Content:  sysmlText,
		ProjectID: projectID,
		Version:  1,
	}

	if err := h.repo.CreateModel(c, m); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建模型失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"model":   m,
			"source":  "papyrus",
			"message": fmt.Sprintf("已从 Papyrus 导入 %d 个包", len(papyrus.Packages)),
		},
	})
}

// ─── ImportCapella 导入 Capella JSON ──────────────────────────────

func (h *Handler) ImportCapella(c *gin.Context) {
	projectID := c.PostForm("projectId")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 projectId"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少文件"})
		return
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}

	var capella CapellaModel
	if err := json.Unmarshal(content, &capella); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("JSON 解析失败: %v", err)})
		return
	}

	sysmlText := convertCapellaToSysMLv2(capella)

	m := &model.Model{
		Name:     strings.TrimSuffix(header.Filename, ".json"),
		Content:  sysmlText,
		ProjectID: projectID,
		Version:  1,
	}

	if err := h.repo.CreateModel(c, m); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建模型失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"model":   m,
			"source":  "capella",
			"message": fmt.Sprintf("已从 Capella 导入 %d 个元素", len(capella.Elements)),
		},
	})
}

// ─── 转换函数 ─────────────────────────────────────────────────────

func convertPapyrusToSysMLv2(p PapyrusModel) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("package %s {\n", sanitizeName(p.Name)))

	for _, pkg := range p.Packages {
		if pkg.Type == "uml:Package" || pkg.Type == "" {
			sb.WriteString(fmt.Sprintf("  package %s {\n", sanitizeName(pkg.Name)))
			for _, elem := range pkg.Elements {
				switch elem.Type {
				case "uml:Class", "uml:Component":
					sb.WriteString(fmt.Sprintf("    part def %s;\n", sanitizeName(elem.Name)))
				case "uml:Port":
					sb.WriteString(fmt.Sprintf("    port %s;\n", sanitizeName(elem.Name)))
				case "uml:Property":
					sb.WriteString(fmt.Sprintf("    attribute %s : String;\n", sanitizeName(elem.Name)))
				}
			}
			sb.WriteString("  }\n")
		} else if pkg.Type == "uml:Class" || pkg.Type == "uml:Component" {
			sb.WriteString(fmt.Sprintf("  part def %s;\n", sanitizeName(pkg.Name)))
		}
	}

	sb.WriteString("}\n")
	return sb.String()
}

func convertCapellaToSysMLv2(c CapellaModel) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("package %s {\n", sanitizeName(c.Name)))

	for _, elem := range c.Elements {
		switch strings.ToLower(elem.Type) {
		case "class", "component", "part":
			sb.WriteString(fmt.Sprintf("  part def %s;\n", sanitizeName(elem.Name)))
		case "port":
			sb.WriteString(fmt.Sprintf("    port %s;\n", sanitizeName(elem.Name)))
		case "property", "attribute":
			sb.WriteString(fmt.Sprintf("    attribute %s : String;\n", sanitizeName(elem.Name)))
		}
	}

	sb.WriteString("}\n")
	return sb.String()
}

// sanitizeName 清理名称（移除空格和特殊字符）
func sanitizeName(name string) string {
	name = strings.ReplaceAll(name, " ", "_")
	name = strings.ReplaceAll(name, "-", "_")
	if name == "" {
		return "unnamed"
	}
	return name
}
