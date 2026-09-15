package metamodel

import (
	"encoding/json"
	"fmt"
	"os"
)

// jsonSchema 是 ptc-25-04-30 SysML.json 的简化结构。
// 真实 schema 含 $id / $schema / definitions 等元数据。
type jsonSchema struct {
	Schema     string                   `json:"$schema"`
	ID         string                   `json:"$id"`
	Definitions map[string]*jsonType     `json:"definitions"`
}

// jsonType 对应一个 type 定义。
type jsonType struct {
	Type                 string                   `json:"type"`  // "object"
	AllOf                []*jsonRef               `json:"allOf"` // 继承父类
	Properties           map[string]*jsonProperty `json:"properties"`
	Required             []string                 `json:"required"`
	Description          string                   `json:"description"`
	AdditionalProperties any                      `json:"additionalProperties"`
}

// jsonRef 是 $ref 引用（如 {"$ref": "#/definitions/Element"}）
type jsonRef struct {
	Ref string `json:"$ref"`
}

// jsonProperty 是元素的属性定义。
type jsonProperty struct {
	Type        any        `json:"type"`        // 可能是 string 或 array
	Description string     `json:"description"`
	Ref         string     `json:"$ref"`        // 复杂类型用 $ref
	Items       *jsonItems `json:"items"`
}

// jsonItems 用于 array type
type jsonItems struct {
	Ref  string `json:"$ref"`
	Type string `json:"type"`
}

// LoadFromFile 从 JSON Schema 文件加载到 Registry。
// 文件应符合 ptc-25-04-30 SysML.json 格式（或 mock 简化版）。
func LoadFromFile(path string) (*Registry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read schema file: %w", err)
	}
	return LoadFromBytes(data)
}

// LoadFromBytes 从 JSON Schema 字节加载到 Registry。
func LoadFromBytes(data []byte) (*Registry, error) {
	var schema jsonSchema
	if err := json.Unmarshal(data, &schema); err != nil {
		return nil, fmt.Errorf("parse schema: %w", err)
	}

	reg := NewRegistry()

	// 第一遍：创建所有 MetaElement（不解析关系）
	for qname, jt := range schema.Definitions {
		if jt == nil {
			continue
		}
		element := &MetaElement{
			QualifiedName: qname,
			Name:          extractName(qname),
			Namespace:     extractNamespace(qname),
			Documentation: jt.Description,
		}
		reg.Add(element)
	}

	// 第二遍：解析继承 + 属性
	for qname, jt := range schema.Definitions {
		if jt == nil {
			continue
		}
		element, ok := reg.Get(qname)
		if !ok {
			continue
		}

		// 解析 allOf（第一项通常是父类 $ref）
		if len(jt.AllOf) > 0 {
			if parent := extractRef(jt.AllOf[0]); parent != "" {
				element.SuperType = parent
				// 更新子类的 SubTypes（直接写，因为 Add 已反向填充）
				// 注：这里冗余写入，幂等
				parentEl, ok := reg.Get(parent)
				if ok {
					found := false
					for _, st := range parentEl.SubTypes {
						if st == qname {
							found = true
							break
						}
					}
					if !found {
						parentEl.SubTypes = append(parentEl.SubTypes, qname)
					}
				}
			}
		}

		// 解析 properties
		requiredSet := make(map[string]bool)
		for _, r := range jt.Required {
			requiredSet[r] = true
		}
		for propName, jp := range jt.Properties {
			if jp == nil {
				continue
			}
			prop := MetaProperty{
				Name:          propName,
				Documentation: jp.Description,
				Required:      requiredSet[propName],
				Multiplicity: Multiplicity{LowerBound: 0, UpperBound: 1},
			}
			// 推断 Type
			if jp.Ref != "" {
				prop.Type = extractRefName(jp.Ref)
			} else if jp.Type != nil {
				if s, ok := jp.Type.(string); ok {
					prop.Type = s
				} else if arr, ok := jp.Type.([]any); ok && len(arr) > 0 {
					// ["string", "null"] → "string"
					if s, ok := arr[0].(string); ok {
						prop.Type = s
					}
				}
			} else if jp.Items != nil {
				if jp.Items.Ref != "" {
					prop.Type = "[]" + extractRefName(jp.Items.Ref)
				} else if jp.Items.Type != "" {
					prop.Type = "[]" + jp.Items.Type
				}
				prop.Multiplicity = Multiplicity{LowerBound: 0, UpperBound: -1}
			}
			element.Properties = append(element.Properties, prop)
		}
	}

	reg.SetSource("loaded")
	return reg, nil
}

// extractName 从 qualifiedName 提取最后一段（Name）。
// "SysML::Block" → "Block"
func extractName(qname string) string {
	idx := lastIndex(qname, "::")
	if idx == -1 {
		return qname
	}
	return qname[idx+2:]
}

// extractNamespace 提取 Namespace。
// "SysML::Block" → "SysML"
func extractNamespace(qname string) string {
	idx := lastIndex(qname, "::")
	if idx == -1 {
		return ""
	}
	return qname[:idx]
}

// extractRef 从 jsonRef 提取 qualifiedName。
// {"$ref": "#/definitions/SysML::Block"} → "SysML::Block"
func extractRef(ref *jsonRef) string {
	if ref == nil {
		return ""
	}
	return extractRefName(ref.Ref)
}

// extractRefName 从 "$ref" 字符串提取 qualifiedName。
func extractRefName(ref string) string {
	// "#/definitions/Foo" → "Foo"
	// "#/definitions/SysML::Block" → "SysML::Block"
	const prefix = "#/definitions/"
	if len(ref) <= len(prefix) {
		return ""
	}
	return ref[len(prefix):]
}

// lastIndex 简单实现 strings.LastIndex（避免引用 strings 包冲突）
func lastIndex(s, substr string) int {
	if len(substr) == 0 {
		return len(s)
	}
	for i := len(s) - len(substr); i >= 0; i-- {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
