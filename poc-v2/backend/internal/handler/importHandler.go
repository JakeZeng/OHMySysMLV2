// M6: 外部模型导入 handler
//
// POST /api/v1/import/papyrus — 导入 Papyrus/SysML v1 XML
// POST /api/v1/import/capella — 导入 Capella JSON
//
// 导入流程：上传文件 → 解析 → 转换为 SysML v2 文本 → **创建 Package**。
//
// ⚠️ M19 E-2：产物从「model」改成「package」。
//
// 改造前这里建的是 `models` 表的一行 —— 但 M12 之后 model 概念已被
// 「Package 一等公民 + View 一等公民」取代（`models` → `packages` + `views`）。
// 于是导入的模型在树上**根本挂不出来**：树面板只吃 `packages` 表，
// `models` 表里的东西用户看不到、点不开 —— 导入完等于「什么都没发生」。
// 现在改建 `packages` 表的一行，导入完立刻能在工程树里看到并打开编辑。
//
// 命名沿用旧约定：**上传文件名去掉后缀**当包名（不改用户的既有预期）。
//
// 权限：与 CreatePackageInProject 一致 —— 必须对目标工程有 **写**权限。

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

// ─── 导入产物落库 ─────────────────────────────────────────────────────

// createImportedPackage 把转换好的 SysML v2 文本存成一个**顶级 Package**。
//
// 同名去重：packages 表对 (project_id, parent, name) 有唯一索引。
// 重复导入同一个文件不应该 409 失败 —— 自动加后缀更符合直觉。
func (h *Handler) createImportedPackage(
	c *gin.Context,
	projectID string,
	name string,
	content string,
) (*model.Package, error) {
	unique := h.uniquePackageName(c, projectID, name)

	now := time.Now().UTC()
	p := &model.Package{
		ID:        uuid.NewString(),
		ProjectID: projectID,
		Name:      unique,
		Content:   content,
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := h.repo.CreatePackage(c, p); err != nil {
		return nil, err
	}
	writeAudit(c, h.repo, model.AuditActionCreate, model.AuditTargetPackage, p.ID,
		`{"name":"`+escapeJSON(p.Name)+`","project":"`+p.ProjectID+`"}`)
	return p, nil
}

// uniquePackageName 给导入的包名去重：同名则追加 _2 / _3 …
func (h *Handler) uniquePackageName(c *gin.Context, projectID string, name string) string {
	summaries, err := h.repo.ListPackagesByProject(c, projectID)
	if err != nil {
		return name
	}
	taken := map[string]bool{}
	for _, s := range summaries {
		if s.ParentPackageID == "" {
			taken[s.Name] = true
		}
	}
	if !taken[name] {
		return name
	}
	for i := 2; i < 1000; i++ {
		candidate := fmt.Sprintf("%s_%d", name, i)
		if !taken[candidate] {
			return candidate
		}
	}
	return name
}

// ─── ImportPapyrus 导入 Papyrus XML ───────────────────────────────

func (h *Handler) ImportPapyrus(c *gin.Context) {
	projectID := c.PostForm("projectId")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 projectId"})
		return
	}

	// 权限：必须对目标工程有写权限。
	// ⚠️ 改造前这个 handler **完全没有权限校验** —— 任何登录用户都能往
	// 别人的工程里塞包。M19 E-2 顺手补上（与 CreatePackageInProject 一致）。
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermWrite); err != nil || !ok {
		return // hasProjectAccess 已写过响应
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

	// M19 E-2：产物是 **package**（不是 M12 之前的 model）。
	pkg, err := h.createImportedPackage(c, projectID,
		strings.TrimSuffix(header.Filename, ".xml"), sysmlText)
	if err != nil {
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "同名包已存在"})
			return
		}
		serverError(c, "创建包失败", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"package": pkg,
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

	// 权限：同 ImportPapyrus，必须对目标工程有写权限。
	if ok, _, err := hasProjectAccess(c, h.repo, projectID, PermWrite); err != nil || !ok {
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

	// M19 E-2：产物是 **package**（不是 M12 之前的 model）。
	pkg, err := h.createImportedPackage(c, projectID,
		strings.TrimSuffix(header.Filename, ".json"), sysmlText)
	if err != nil {
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "同名包已存在"})
			return
		}
		serverError(c, "创建包失败", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"package": pkg,
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
