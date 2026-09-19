// M6: 外部模型导入 handler
//
// POST /api/v1/import/papyrus — 导入 Papyrus/SysML v1 XML
// POST /api/v1/import/capella — 导入 Capella JSON
//
// 导入流程：上传文件 → 解析 → 转换为 SysML v2 文本 → 创建 Model。

package handler

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── Papyrus XML 解析 ─────────────────────────────────────────────

// PapyrusModel Papyrus UML/SysML v1 XML 模型
//
// XML tag 不写前缀，因为我们先剥掉 xmlns 声明 + element/attr prefix 再 unmarshal。
// 这样无论上游工具导出带不带 xmlns 都能解析，且 attribute 值里的
// "xmi:type=\"uml:Package\"" 也会变 "type=\"Package\""，方便 switch。
type PapyrusModel struct {
	XMLName  xml.Name         `xml:"Model"`
	Name     string           `xml:"name,attr"`
	Packages []PapyrusPackage `xml:"packagedElement"`
}

// PapyrusPackage 包
type PapyrusPackage struct {
	Type     string           `xml:"type,attr"`
	Name     string           `xml:"name,attr"`
	Elements []PapyrusElement `xml:"packagedElement"`
}

// PapyrusElement 元素
type PapyrusElement struct {
	Type   string `xml:"type,attr"`
	Name   string `xml:"name,attr"`
	ID     string `xml:"id,attr"`
	IsLeaf bool   `xml:"isLeaf,attr"`
}

// ─── Capella JSON 解析 ─────────────────────────────────────────────

// CapellaModel Capella JSON 模型
type CapellaModel struct {
	Name     string           `json:"name"`
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

	content, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}

	// 解析 XML。
	// Papyrus 文件使用 xmlns:uml="..." 等命名空间前缀；Go 的 encoding/xml 会
	// 把 attribute value 里的 "uml:Package" 保留为 prefix:localname 形式。
	// 这里总是先剥掉 xmlns 声明 + element/attr prefix 再 unmarshal，保证
	// attribute value 是裸的 "Package"/"Class"/"Component" 等。
	var papyrus PapyrusModel
	stripped := stripXMLNamespacePrefixes(content)
	if err := xml.Unmarshal(stripped, &papyrus); err != nil {
		// 容错：直接尝试 unmarshal 原 content（理论上 XML 本身合法时 strip + unmarshal 总会成功）
		if err2 := xml.Unmarshal(content, &papyrus); err2 != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("XML 解析失败: %v（已尝试剥离命名空间前缀）", err2),
			})
			return
		}
	}

	sysmlText := convertPapyrusToSysMLv2(papyrus)

	now := time.Now().UTC()
	m := &model.Model{
		ID:        uuid.NewString(),
		Name:      strings.TrimSuffix(header.Filename, ".xml"),
		Content:   sysmlText,
		ProjectID: projectID,
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
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

	now := time.Now().UTC()
	m := &model.Model{
		ID:        uuid.NewString(),
		Name:      strings.TrimSuffix(header.Filename, ".json"),
		Content:   sysmlText,
		ProjectID: projectID,
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
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
		switch pkg.Type {
		case "Package", "":
			sb.WriteString(fmt.Sprintf("  package %s {\n", sanitizeName(pkg.Name)))
			for _, elem := range pkg.Elements {
				switch elem.Type {
				case "Class", "Component":
					sb.WriteString(fmt.Sprintf("    part def %s;\n", sanitizeName(elem.Name)))
				case "Port":
					// M6 修复：SysML v2 port 用法必须有类型引用。
					// Papyrus Port 默认指向 UML Port（SysML v2 内置），用 String 占位。
					sb.WriteString(fmt.Sprintf("    port %s : String;\n", sanitizeName(elem.Name)))
				case "Property":
					sb.WriteString(fmt.Sprintf("    attribute %s : String;\n", sanitizeName(elem.Name)))
				}
			}
			sb.WriteString("  }\n")
		case "Class", "Component":
			sb.WriteString(fmt.Sprintf("  part def %s;\n", sanitizeName(pkg.Name)))
		}
	}

	sb.WriteString("}\n")
	return sb.String()
}

func convertCapellaToSysMLv2(c CapellaModel) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("package %s {\n", sanitizeName(c.Name)))

	// M6 修复：Capella 端口必须有类型引用；属性保持 : String 类型。
	for _, elem := range c.Elements {
		switch strings.ToLower(elem.Type) {
		case "class", "component", "part":
			sb.WriteString(fmt.Sprintf("  part def %s;\n", sanitizeName(elem.Name)))
		case "port":
			sb.WriteString(fmt.Sprintf("  port %s : String;\n", sanitizeName(elem.Name)))
		case "property", "attribute":
			sb.WriteString(fmt.Sprintf("  attribute %s : String;\n", sanitizeName(elem.Name)))
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

// stripXMLNamespacePrefixes 把 "<uml:Model xmlns:uml=...>" 之类的带前缀 XML
// 简单剥成 "<Model>"。这是宽松回退：真实 Papyrus 文件应保留 xmlns，让 Go
// encoding/xml 自动推断命名空间，但当上游工具导出缺 xmlns 时仍能解析。
//
// 实现：
//  1. 用正则删所有 xmlns[:prefix]=... 或 xmlns="..." 声明（含前导空白）
//  2. 在 tag 区内识别 element / attr name（首字母 + 字母数字_-:.），截掉 prefix
func stripXMLNamespacePrefixes(content []byte) []byte {
	s := string(content)
	// 1. 删 xmlns 声明。匹配 " xmlns[:prefix]=["']...["']"（含前导空白）
	xmlnsRe := regexp.MustCompile(`\s+xmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*(?:"[^"]*"|'[^']*')`)
	s = xmlnsRe.ReplaceAllString(s, "")
	// 2. 删 element / attr name 上的 prefix。
	var out strings.Builder
	out.Grow(len(s))
	i := 0
	inTag := false
	for i < len(s) {
		c := s[i]
		if c == '<' {
			inTag = true
			out.WriteByte(c)
			i++
			continue
		}
		if c == '>' {
			inTag = false
			out.WriteByte(c)
			i++
			continue
		}
		if inTag {
			// 在 tag 内：识别 name（字母/下划线开头的 token），把 prefix: 去掉
			if isNameStart(c) {
				start := i
				for i < len(s) && isNameChar(s[i]) {
					i++
				}
				name := s[start:i]
				if eq := strings.Index(name, ":"); eq > 0 {
					name = name[eq+1:]
				}
				out.WriteString(name)
				continue
			}
		}
		out.WriteByte(c)
		i++
	}
	return []byte(out.String())
}

func isNameStart(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || c == ':'
}

func isNameChar(c byte) bool {
	return isNameStart(c) || (c >= '0' && c <= '9') || c == '-' || c == '.'
}
