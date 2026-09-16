package metamodel

// mockSchema 是 mock 的 SysML v2 元模型 JSON。
// 用于单元测试 + W1 末 D3-4 dev 验证。
// 真实 M3 W1 D3 实施时，会从 OMG ptc-25-04-30 SysML.json 替换。
const mockSchema = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://www.omg.org/spec/SysML/2.0/JSON",
  "definitions": {
    "SysML::Element": {
      "type": "object",
      "description": "SysML v2 root element",
      "properties": {
        "name": {"type": "string", "description": "Element name"},
        "documentation": {"type": "string", "description": "Doc comment"}
      },
      "required": ["name"]
    },
    "SysML::Package": {
      "allOf": [{"$ref": "#/definitions/SysML::Namespace"}],
      "description": "A namespace for grouping elements"
    },
    "SysML::LibraryPackage": {
      "allOf": [{"$ref": "#/definitions/SysML::Namespace"}],
      "description": "A library package"
    },
    "SysML::Namespace": {
      "allOf": [{"$ref": "#/definitions/SysML::Element"}],
      "description": "A namespace (Package, LibraryPackage)"
    },
    "SysML::Classifier": {
      "allOf": [{"$ref": "#/definitions/SysML::Element"}],
      "description": "A type that can be specialized"
    },
    "SysML::Block": {
      "allOf": [{"$ref": "#/definitions/SysML::Classifier"}],
      "description": "A physical or logical block. The most common classifier in SysML v2."
    },
    "SysML::ItemDef": {
      "allOf": [{"$ref": "#/definitions/SysML::Classifier"}],
      "description": "A classifier for items (physical entities distinct from blocks)"
    },
    "SysML::ActionDef": {
      "allOf": [{"$ref": "#/definitions/SysML::Classifier"}],
      "description": "A classifier for actions (behaviors)"
    },
    "SysML::RequirementDef": {
      "allOf": [{"$ref": "#/definitions/SysML::Classifier"}],
      "description": "A classifier for requirements"
    },
    "SysML::Feature": {
      "allOf": [{"$ref": "#/definitions/SysML::Element"}],
      "description": "A structural or behavioral characteristic of a classifier"
    },
    "SysML::Attribute": {
      "allOf": [{"$ref": "#/definitions/SysML::Feature"}],
      "description": "A typed value feature"
    },
    "SysML::Port": {
      "allOf": [{"$ref": "#/definitions/SysML::Feature"}],
      "description": "An interaction point on a block"
    },
    "SysML::Step": {
      "allOf": [{"$ref": "#/definitions/SysML::Feature"}],
      "description": "A step within an action"
    },
    "SysML::Expression": {
      "allOf": [{"$ref": "#/definitions/SysML::Feature"}],
      "description": "An expression feature"
    },
    "SysML::Reference": {
      "allOf": [{"$ref": "#/definitions/SysML::Feature"}],
      "description": "A reference feature"
    },
    "SysML::DataType": {
      "allOf": [{"$ref": "#/definitions/SysML::Classifier"}],
      "description": "A data type (primitive or composite)"
    },
    "SysML::Structure": {
      "allOf": [{"$ref": "#/definitions/SysML::DataType"}],
      "description": "A structure data type"
    },
    "SysML::Enumeration": {
      "allOf": [{"$ref": "#/definitions/SysML::DataType"}],
      "description": "An enumeration data type"
    },
    "SysML::Association": {
      "allOf": [{"$ref": "#/definitions/SysML::Classifier"}],
      "description": "An association classifier"
    },
    "SysML::Subclassification": {
      "allOf": [{"$ref": "#/definitions/SysML::Relationship"}],
      "description": "A specialization relationship between classifiers"
    },
    "SysML::Redefinition": {
      "allOf": [{"$ref": "#/definitions/SysML::Relationship"}],
      "description": "A redefinition relationship"
    },
    "SysML::Relationship": {
      "allOf": [{"$ref": "#/definitions/SysML::Element"}],
      "description": "Base class for all relationships"
    },
    "SysML::FeatureChaining": {
      "allOf": [{"$ref": "#/definitions/SysML::Relationship"}],
      "description": "Feature chaining relationship"
    },
    "SysML::TypeFeaturing": {
      "allOf": [{"$ref": "#/definitions/SysML::Relationship"}],
      "description": "Type featuring relationship"
    },
    "SysML::Subsetting": {
      "allOf": [{"$ref": "#/definitions/SysML::Relationship"}],
      "description": "Subsetting relationship"
    },
    "SysML::ItemFeature": {
      "allOf": [{"$ref": "#/definitions/SysML::Feature"}],
      "description": "Item feature (special case of feature)"
    },
    "SysML::AnnotatingElement": {
      "allOf": [{"$ref": "#/definitions/SysML::Element"}],
      "description": "An element that annotates another element (e.g. comment)"
    },
    "SysML::Documentation": {
      "allOf": [{"$ref": "#/definitions/SysML::Element"}],
      "description": "Documentation comment"
    }
  }
}`

// NewMockRegistry 创建一个加载了 mock schema 的 Registry。
// 用于 M3 W1 dev 阶段 + 单元测试。
func NewMockRegistry() (*Registry, error) {
	return LoadFromBytes([]byte(mockSchema))
}
