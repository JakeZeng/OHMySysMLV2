package metamodel

// mockSchema 是 mock 的 SysML v2 元模型 JSON。
// 用于单元测试 + W1 末 D3-4 dev 验证。
// 真实 M3 W1 D3 实施时，会从 OMG ptc-25-04-30 SysML.json 替换。
const mockSchema = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://www.omg.org/spec/SysML/2.0/JSON",
  "definitions": {
    "Element": {
      "type": "object",
      "description": "SysML v2 root element",
      "properties": {
        "name": {"type": "string", "description": "Element name"},
        "documentation": {"type": "string", "description": "Doc comment"}
      },
      "required": ["name"]
    },
    "Package": {
      "allOf": [{"$ref": "#/definitions/Namespace"}],
      "description": "A namespace for grouping elements"
    },
    "Namespace": {
      "allOf": [{"$ref": "#/definitions/Element"}],
      "description": "A namespace (Package, LibraryPackage)"
    },
    "Classifier": {
      "allOf": [{"$ref": "#/definitions/Element"}],
      "description": "A type that can be specialized"
    },
    "Block": {
      "allOf": [{"$ref": "#/definitions/Classifier"}],
      "description": "A physical or logical block. The most common classifier in SysML v2."
    },
    "ItemDef": {
      "allOf": [{"$ref": "#/definitions/Classifier"}],
      "description": "A classifier for items (physical entities distinct from blocks)"
    },
    "ActionDef": {
      "allOf": [{"$ref": "#/definitions/Classifier"}],
      "description": "A classifier for actions (behaviors)"
    },
    "RequirementDef": {
      "allOf": [{"$ref": "#/definitions/Classifier"}],
      "description": "A classifier for requirements"
    },
    "Feature": {
      "allOf": [{"$ref": "#/definitions/Element"}],
      "description": "A structural or behavioral characteristic of a classifier"
    },
    "Attribute": {
      "allOf": [{"$ref": "#/definitions/Feature"}],
      "description": "A typed value feature"
    },
    "Port": {
      "allOf": [{"$ref": "#/definitions/Feature"}],
      "description": "An interaction point on a block"
    },
    "Step": {
      "allOf": [{"$ref": "#/definitions/Feature"}],
      "description": "A step within an action"
    },
    "DataType": {
      "allOf": [{"$ref": "#/definitions/Classifier"}],
      "description": "A data type (primitive or composite)"
    },
    "Structure": {
      "allOf": [{"$ref": "#/definitions/DataType"}],
      "description": "A structure data type"
    },
    "Subclassification": {
      "allOf": [{"$ref": "#/definitions/Relationship"}],
      "description": "A specialization relationship between classifiers"
    },
    "Relationship": {
      "allOf": [{"$ref": "#/definitions/Element"}],
      "description": "Base class for all relationships"
    }
  }
}`

// NewMockRegistry 创建一个加载了 mock schema 的 Registry。
// 用于 M3 W1 dev 阶段 + 单元测试。
func NewMockRegistry() (*Registry, error) {
	return LoadFromBytes([]byte(mockSchema))
}
