// 代码生成 handler
//
// 从 SysML 模型生成代码（Python/C++ class stubs）。
//
// POST /api/v1/codegen/generate — 从模型生成代码

package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ─── 请求/响应 ────────────────────────────────────────────────────

// CodeGenRequest 代码生成请求
type CodeGenRequest struct {
	ModelID  string `json:"modelId" binding:"required"`
	Language string `json:"language" binding:"required"` // "python" or "cpp"
}

// CodeGenResponse 代码生成响应
type CodeGenResponse struct {
	Language string `json:"language"`
	Files    []CodeGenFile `json:"files"`
}

// CodeGenFile 生成的代码文件
type CodeGenFile struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// GenerateCode 从模型生成代码
func (h *Handler) GenerateCode(c *gin.Context) {
	var req CodeGenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 获取模型
	m, err := h.repo.GetModel(c, req.ModelID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "模型不存在"})
		return
	}

	// 解析模型内容，提取 part def
	elements := extractPartDefs(m.Content)

	// 根据语言生成代码
	var files []CodeGenFile
	switch req.Language {
	case "python":
		files = generatePython(elements)
	case "cpp":
		files = generateCPP(elements)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的语言，仅支持 python 和 cpp"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": CodeGenResponse{
		Language: req.Language,
		Files:    files,
	}})
}

// ─── 元素提取 ─────────────────────────────────────────────────────

type PartDef struct {
	Name       string
	Attributes []Attribute
	Ports      []Port
	Parts      []PartUsage
}

type Attribute struct {
	Name    string
	Type    string
	Default string
}

type Port struct {
	Name      string
	Type      string
	Direction string
}

type PartUsage struct {
	Name    string
	TypeRef string
}

func extractPartDefs(content string) []PartDef {
	var defs []PartDef
	lines := strings.Split(content, "\n")

	var current *PartDef
	indent := 0

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "part def ") {
			name := strings.TrimSuffix(strings.TrimPrefix(trimmed, "part def "), " {")
			defs = append(defs, PartDef{Name: name})
			current = &defs[len(defs)-1]
			indent = 1
		} else if trimmed == "}" && indent > 0 {
			indent--
			if indent == 0 {
				current = nil
			}
		} else if current != nil && indent == 1 {
			if strings.HasPrefix(trimmed, "attribute ") {
				// attribute name : Type = default;
				rest := strings.TrimSuffix(strings.TrimPrefix(trimmed, "attribute "), ";")
				parts := strings.SplitN(rest, ":", 2)
				if len(parts) == 2 {
					attr := Attribute{Name: strings.TrimSpace(parts[0])}
					typeDefault := strings.TrimSpace(parts[1])
					if eqIdx := strings.Index(typeDefault, "="); eqIdx >= 0 {
						attr.Type = strings.TrimSpace(typeDefault[:eqIdx])
						attr.Default = strings.TrimSpace(typeDefault[eqIdx+1:])
					} else {
						attr.Type = typeDefault
					}
					current.Attributes = append(current.Attributes, attr)
				}
			} else if strings.HasPrefix(trimmed, "port ") {
				// port name : Type;
				rest := strings.TrimSuffix(strings.TrimPrefix(trimmed, "port "), ";")
				parts := strings.SplitN(rest, ":", 2)
				if len(parts) == 2 {
					current.Ports = append(current.Ports, Port{
						Name: strings.TrimSpace(parts[0]),
						Type: strings.TrimSpace(parts[1]),
					})
				}
			} else if strings.HasPrefix(trimmed, "part ") && strings.Contains(trimmed, ":") {
				// part name : Type;
				rest := strings.TrimSuffix(strings.TrimPrefix(trimmed, "part "), ";")
				parts := strings.SplitN(rest, ":", 2)
				if len(parts) == 2 {
					current.Parts = append(current.Parts, PartUsage{
						Name:    strings.TrimSpace(parts[0]),
						TypeRef: strings.TrimSpace(parts[1]),
					})
				}
			}
		}
	}

	return defs
}

// ─── Python 生成 ──────────────────────────────────────────────────

func generatePython(elements []PartDef) []CodeGenFile {
	var files []CodeGenFile

	// 生成 __init__.py
	files = append(files, CodeGenFile{
		Name:    "__init__.py",
		Content: `"""Auto-generated from SysML v2 model."""
`,
	})

	// 为每个 part def 生成一个文件
	for _, elem := range elements {
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf(`"""%s - Auto-generated from SysML v2."""

from dataclasses import dataclass, field
from typing import Optional


`, elem.Name))

		// 生成属性 dataclass
		if len(elem.Attributes) > 0 {
			sb.WriteString(fmt.Sprintf("@dataclass\nclass %sAttributes:\n", elem.Name))
			for _, attr := range elem.Attributes {
				pyType := mapSysMLTypeToPython(attr.Type)
				if attr.Default != "" {
					sb.WriteString(fmt.Sprintf("    %s: %s = %s\n", attr.Name, pyType, attr.Default))
				} else {
					sb.WriteString(fmt.Sprintf("    %s: Optional[%s] = None\n", attr.Name, pyType))
				}
			}
			sb.WriteString("\n\n")
		}

		// 生成主类
		sb.WriteString(fmt.Sprintf("class %s:\n", elem.Name))
		sb.WriteString(fmt.Sprintf(`    \"\"\"SysML v2 part def: %s.\"\"\"\n\n`, elem.Name))
		sb.WriteString("    def __init__(self):\n")

		// 初始化属性
		if len(elem.Attributes) > 0 {
			sb.WriteString("        # Attributes\n")
			for _, attr := range elem.Attributes {
				if attr.Default != "" {
					sb.WriteString(fmt.Sprintf("        self.%s = %s\n", attr.Name, attr.Default))
				} else {
					sb.WriteString(fmt.Sprintf("        self.%s = None\n", attr.Name))
				}
			}
		}

		// 初始化子部件
		if len(elem.Parts) > 0 {
			sb.WriteString("\n        # Sub-parts\n")
			for _, part := range elem.Parts {
				sb.WriteString(fmt.Sprintf("        self.%s = %s()  # TODO: initialize\n", part.Name, part.TypeRef))
			}
		}

		// 初始化端口
		if len(elem.Ports) > 0 {
			sb.WriteString("\n        # Ports\n")
			for _, port := range elem.Ports {
				sb.WriteString(fmt.Sprintf("        self.%s_port = None  # %s\n", port.Name, port.Type))
			}
		}

		sb.WriteString("\n")

		// 生成方法桩
		sb.WriteString("    def validate(self) -> bool:\n")
		sb.WriteString("        \"\"\"Validate the component.\"\"\"\n")
		sb.WriteString("        return True\n\n")

		sb.WriteString("    def to_dict(self) -> dict:\n")
		sb.WriteString("        \"\"\"Serialize to dictionary.\"\"\"\n")
		sb.WriteString("        return {\n")
		sb.WriteString(fmt.Sprintf("            'type': '%s',\n", elem.Name))
		for _, attr := range elem.Attributes {
			sb.WriteString(fmt.Sprintf("            '%s': self.%s,\n", attr.Name, attr.Name))
		}
		sb.WriteString("        }\n")

		files = append(files, CodeGenFile{
			Name:    strings.ToLower(elem.Name) + ".py",
			Content: sb.String(),
		})
	}

	return files
}

// ─── C++ 生成 ─────────────────────────────────────────────────────

func generateCPP(elements []PartDef) []CodeGenFile {
	var files []CodeGenFile

	// 头文件
	var headerSB strings.Builder
	headerSB.WriteString(`// Auto-generated from SysML v2 model.
#pragma once

#include <string>
#include <vector>
#include <optional>
#include <map>

`)

	for _, elem := range elements {
		headerSB.WriteString(fmt.Sprintf("class %s {\n", elem.Name))
		headerSB.WriteString("public:\n")

		// 构造函数
		headerSB.WriteString(fmt.Sprintf("    %s();\n", elem.Name))

		// 属性 getter/setter
		for _, attr := range elem.Attributes {
			cppType := mapSysMLTypeToCPP(attr.Type)
			headerSB.WriteString(fmt.Sprintf("    %s get%s() const;\n", cppType, capitalize(attr.Name)))
			headerSB.WriteString(fmt.Sprintf("    void set%s(%s value);\n", capitalize(attr.Name), cppType))
		}

		// 端口
		for _, port := range elem.Ports {
			headerSB.WriteString(fmt.Sprintf("    // Port: %s (%s)\n", port.Name, port.Type))
		}

		// 子部件
		for _, part := range elem.Parts {
			headerSB.WriteString(fmt.Sprintf("    %s* get%s();\n", part.TypeRef, capitalize(part.Name)))
		}

		headerSB.WriteString("\nprivate:\n")
		for _, attr := range elem.Attributes {
			cppType := mapSysMLTypeToCPP(attr.Type)
			headerSB.WriteString(fmt.Sprintf("    %s %s_;\n", cppType, attr.Name))
		}
		for _, part := range elem.Parts {
			headerSB.WriteString(fmt.Sprintf("    %s* %s_ = nullptr;\n", part.TypeRef, part.Name))
		}

		headerSB.WriteString("};\n\n")
	}

	files = append(files, CodeGenFile{
		Name:    "model.h",
		Content: headerSB.String(),
	})

	// 实现文件
	var implSB strings.Builder
	implSB.WriteString(`// Auto-generated from SysML v2 model.
#include "model.h"

`)

	for _, elem := range elements {
		implSB.WriteString(fmt.Sprintf("%s::%s() {\n", elem.Name, elem.Name))
		for _, attr := range elem.Attributes {
			if attr.Default != "" {
				implSB.WriteString(fmt.Sprintf("    %s_ = %s;\n", attr.Name, attr.Default))
			}
		}
		implSB.WriteString("}\n\n")

		for _, attr := range elem.Attributes {
			cppType := mapSysMLTypeToCPP(attr.Type)
			implSB.WriteString(fmt.Sprintf("%s %s::get%s() const { return %s_; }\n",
				cppType, elem.Name, capitalize(attr.Name), attr.Name))
			implSB.WriteString(fmt.Sprintf("void %s::set%s(%s value) { %s_ = value; }\n\n",
				elem.Name, capitalize(attr.Name), cppType, attr.Name))
		}
	}

	files = append(files, CodeGenFile{
		Name:    "model.cpp",
		Content: implSB.String(),
	})

	return files
}

// ─── 类型映射 ─────────────────────────────────────────────────────

func mapSysMLTypeToPython(sysmlType string) string {
	switch strings.ToLower(sysmlType) {
	case "real", "double", "float":
		return "float"
	case "integer", "int", "natural", "positive":
		return "int"
	case "boolean", "bool":
		return "bool"
	case "string":
		return "str"
	default:
		return "Any"
	}
}

func mapSysMLTypeToCPP(sysmlType string) string {
	switch strings.ToLower(sysmlType) {
	case "real", "double", "float":
		return "double"
	case "integer", "int":
		return "int"
	case "natural", "positive":
		return "unsigned int"
	case "boolean", "bool":
		return "bool"
	case "string":
		return "std::string"
	default:
		return "auto"
	}
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
