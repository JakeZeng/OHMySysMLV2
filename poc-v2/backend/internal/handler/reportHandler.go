// M7: 设计文档生成 handler
//
// POST /api/v1/reports/generate — 从模型生成设计文档（Markdown/HTML）
//
// 输入：projectId + modelId + 格式（md/html）+ 可选模板
// 输出：生成的文档内容

package handler

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── 请求/响应 ────────────────────────────────────────────────────

// GenerateReportRequest 报告生成请求
type GenerateReportRequest struct {
	ProjectID string `json:"projectId" binding:"required"`
	ModelID   string `json:"modelId" binding:"required"`
	Format    string `json:"format"` // "md" or "html"，默认 "md"
	Title     string `json:"title"`
}

// GenerateReport 生成设计文档
func (h *Handler) GenerateReport(c *gin.Context) {
	var req GenerateReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Format == "" {
		req.Format = "md"
	}

	// 获取模型
	m, err := h.repo.GetModel(c, req.ModelID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "模型不存在"})
		return
	}

	// 获取项目
	p, err := h.repo.GetProject(c, req.ProjectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}

	title := req.Title
	if title == "" {
		title = m.Name
	}

	// 生成文档
	var content string
	if req.Format == "html" {
		content = generateHTML(p.Name, title, m.Content, m.Version)
	} else {
		content = generateMarkdown(p.Name, title, m.Content, m.Version)
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"title":   title,
			"format":  req.Format,
			"content": content,
			"size":    len(content),
		},
	})
}

// ─── Markdown 生成 ────────────────────────────────────────────────

func generateMarkdown(projectName, title, sysmlContent string, version int) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("# %s\n\n", title))
	sb.WriteString(fmt.Sprintf("**项目**: %s  \n", projectName))
	sb.WriteString(fmt.Sprintf("**版本**: v%d  \n", version))
	sb.WriteString(fmt.Sprintf("**生成时间**: %s  \n\n", time.Now().Format("2006-01-02 15:04:05")))
	sb.WriteString("---\n\n")

	// 1. 概述
	sb.WriteString("## 1. 概述\n\n")
	sb.WriteString("本文档由 SysML v2 MBSE 平台自动生成，基于模型中的结构定义和关系。\n\n")

	// 2. 模型结构
	sb.WriteString("## 2. 模型结构\n\n")
	elements := extractElements(sysmlContent)
	sb.WriteString(fmt.Sprintf("模型包含以下 **%d** 个结构元素：\n\n", len(elements)))

	sb.WriteString("| 类型 | 名称 |\n")
	sb.WriteString("|------|------|\n")
	for _, e := range elements {
		sb.WriteString(fmt.Sprintf("| %s | %s |\n", e.Type, e.Name))
	}
	sb.WriteString("\n")

	// 3. 关系
	sb.WriteString("## 3. 连接关系\n\n")
	connections := extractConnections(sysmlContent)
	if len(connections) == 0 {
		sb.WriteString("模型中未定义连接关系。\n\n")
	} else {
		sb.WriteString("| 源端 | 目标端 |\n")
		sb.WriteString("|------|--------|\n")
		for _, conn := range connections {
			sb.WriteString(fmt.Sprintf("| %s | %s |\n", conn.Source, conn.Target))
		}
		sb.WriteString("\n")
	}

	// 4. 需求追溯
	sb.WriteString("## 4. 需求追溯\n\n")
	requirements := extractRequirements(sysmlContent)
	if len(requirements) == 0 {
		sb.WriteString("模型中未定义需求。\n\n")
	} else {
		for _, req := range requirements {
			sb.WriteString(fmt.Sprintf("- **%s**: %s\n", req.ID, req.Description))
		}
		sb.WriteString("\n")
	}

	// 5. 约束
	sb.WriteString("## 5. 约束条件\n\n")
	constraints := extractConstraints(sysmlContent)
	if len(constraints) == 0 {
		sb.WriteString("模型中未定义约束。\n\n")
	} else {
		for _, c := range constraints {
			sb.WriteString(fmt.Sprintf("- **%s**: %s\n", c.Name, c.Constraint))
		}
		sb.WriteString("\n")
	}

	// 6. 源代码
	sb.WriteString("## 6. SysML v2 源代码\n\n")
	sb.WriteString("```sysml\n")
	sb.WriteString(sysmlContent)
	sb.WriteString("\n```\n\n")

	sb.WriteString("---\n\n")
	sb.WriteString("*此文档由 SysML v2 MBSE 平台自动生成*\n")

	return sb.String()
}

// ─── HTML 生成 ────────────────────────────────────────────────────

func generateHTML(projectName, title, sysmlContent string, version int) string {
	md := generateMarkdown(projectName, title, sysmlContent, version)

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>%s</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 40px; color: #1f2328; line-height: 1.6; }
    h1 { border-bottom: 2px solid #d0d7de; padding-bottom: 8px; }
    h2 { color: #1f2328; margin-top: 24px; }
    table { border-collapse: collapse; width: 100%%; margin: 16px 0; }
    th, td { border: 1px solid #d0d7de; padding: 8px 12px; text-align: left; }
    th { background: #f6f8fa; }
    code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
    hr { border: none; border-top: 1px solid #d0d7de; margin: 24px 0; }
  </style>
</head>
<body>
  <pre>%s</pre>
</body>
</html>`, title, md)
}

// ─── 元素提取（简化版）────────────────────────────────────────────

type extractedElement struct {
	Type string
	Name string
}

type extractedConnection struct {
	Source string
	Target string
}

type extractedRequirement struct {
	ID          string
	Description string
}

type extractedConstraint struct {
	Name       string
	Constraint string
}

func extractElements(content string) []extractedElement {
	var elements []extractedElement
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "part def ") {
			name := strings.TrimSuffix(strings.TrimPrefix(line, "part def "), " {")
			elements = append(elements, extractedElement{"Part Def", name})
		} else if strings.HasPrefix(line, "port def ") {
			name := strings.TrimSuffix(strings.TrimPrefix(line, "port def "), " {")
			elements = append(elements, extractedElement{"Port Def", name})
		} else if strings.HasPrefix(line, "part ") && strings.Contains(line, ":") {
			parts := strings.SplitN(line, ":", 2)
			name := strings.TrimSpace(strings.TrimPrefix(parts[0], "part "))
			elements = append(elements, extractedElement{"Part", name})
		} else if strings.HasPrefix(line, "state machine ") {
			name := strings.TrimSuffix(strings.TrimPrefix(line, "state machine "), " {")
			elements = append(elements, extractedElement{"State Machine", name})
		} else if strings.HasPrefix(line, "activity ") {
			name := strings.TrimSuffix(strings.TrimPrefix(line, "activity "), " {")
			elements = append(elements, extractedElement{"Activity", name})
		} else if strings.HasPrefix(line, "constraint def ") {
			name := strings.TrimSuffix(strings.TrimPrefix(line, "constraint def "), " {")
			elements = append(elements, extractedElement{"Constraint", name})
		}
	}
	return elements
}

func extractConnections(content string) []extractedConnection {
	var conns []extractedConnection
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "connect ") {
			parts := strings.SplitN(strings.TrimPrefix(line, "connect "), " to ", 2)
			if len(parts) == 2 {
				source := strings.TrimSpace(parts[0])
				target := strings.TrimSuffix(strings.TrimSpace(parts[1]), ";")
				conns = append(conns, extractedConnection{source, target})
			}
		}
	}
	return conns
}

func extractRequirements(content string) []extractedRequirement {
	var reqs []extractedRequirement
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "requirement def ") {
			// 格式: requirement def Name (ID) {text};
			rest := strings.TrimPrefix(line, "requirement def ")
			// 提取 ID
			if idx1 := strings.Index(rest, "("); idx1 >= 0 {
				if idx2 := strings.Index(rest, ")"); idx2 > idx1 {
					id := rest[idx1+1 : idx2]
					name := strings.TrimSpace(rest[:idx1])
					desc := ""
					if idx3 := strings.Index(rest, "{"); idx3 >= 0 {
						if idx4 := strings.Index(rest, "}"); idx4 > idx3 {
							desc = rest[idx3+1 : idx4]
						}
					}
					if desc == "" {
						desc = name
					}
					reqs = append(reqs, extractedRequirement{id, desc})
				}
			}
		}
	}
	return reqs
}

func extractConstraints(content string) []extractedConstraint {
	var constraints []extractedConstraint
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "constraint def ") {
			name := strings.TrimSuffix(strings.TrimPrefix(line, "constraint def "), " {")
			constraints = append(constraints, extractedConstraint{name, ""})
		}
	}
	return constraints
}
