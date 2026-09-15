package metamodel

import (
	"testing"
)

// --- 测试 1: Mock schema 加载 ---

func TestNewMockRegistry_Load(t *testing.T) {
	reg, err := NewMockRegistry()
	if err != nil {
		t.Fatalf("NewMockRegistry failed: %v", err)
	}
	if reg == nil {
		t.Fatal("registry is nil")
	}
	// Mock schema 含 18 个定义
	expectedMin := 18
	if reg.Count() < expectedMin {
		t.Errorf("expected at least %d elements, got %d", expectedMin, reg.Count())
	}
}

func TestNewMockRegistry_Get(t *testing.T) {
	reg, _ := NewMockRegistry()

	tests := []struct {
		qname      string
		wantName   string
		wantParent string
	}{
		{"SysML::Block", "Block", "SysML::Classifier"},
		{"SysML::Port", "Port", "SysML::Feature"},
		{"SysML::Package", "Package", "SysML::Namespace"},
		{"SysML::Attribute", "Attribute", "SysML::Feature"},
	}

	for _, tt := range tests {
		t.Run(tt.qname, func(t *testing.T) {
			e, ok := reg.Get(tt.qname)
			if !ok {
				t.Fatalf("Get(%q) failed", tt.qname)
			}
			if e.Name != tt.wantName {
				t.Errorf("Name = %q, want %q", e.Name, tt.wantName)
			}
			if e.SuperType != tt.wantParent {
				t.Errorf("SuperType = %q, want %q", e.SuperType, tt.wantParent)
			}
		})
	}
}

// --- 测试 2: ByKind 过滤 ---

func TestRegistry_ByKind(t *testing.T) {
	reg, _ := NewMockRegistry()

	tests := []struct {
		kind     ElementKind
		wantMin  int
	}{
		{KindClassifier, 5},  // Block, ItemDef, ActionDef, RequirementDef, DataType
		{KindFeature, 3},     // Attribute, Port, Step
		{KindNamespace, 1},   // Package
		{KindRelationship, 1}, // Subclassification
	}

	for _, tt := range tests {
		t.Run(tt.kind.String(), func(t *testing.T) {
			elements := reg.ByKind(tt.kind)
			if len(elements) < tt.wantMin {
				t.Errorf("ByKind(%v) returned %d elements, want at least %d",
					tt.kind, len(elements), tt.wantMin)
			}
		})
	}
}

// --- 测试 3: SubTypesOf 反向索引 ---

func TestRegistry_SubTypesOf(t *testing.T) {
	reg, _ := NewMockRegistry()

	// Classifier 应有多个子类（Block, ItemDef, ActionDef, RequirementDef, DataType）
	subs := reg.SubTypesOf("SysML::Classifier")
	if len(subs) < 4 {
		t.Errorf("Classifier should have at least 4 subtypes, got %d", len(subs))
	}

	// Element 是根，应有多个子类
	elementSubs := reg.SubTypesOf("SysML::Element")
	if len(elementSubs) < 5 {
		t.Errorf("Element should have at least 5 subtypes, got %d", len(elementSubs))
	}
}

// --- 测试 4: Search 模糊查询 ---

func TestRegistry_Search(t *testing.T) {
	reg, _ := NewMockRegistry()

	// 查 "Block"
	results := reg.Search("Block")
	if len(results) == 0 {
		t.Error("Search('Block') returned no results")
	}
	found := false
	for _, e := range results {
		if e.Name == "Block" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Search('Block') should include Block element")
	}

	// 查 "Feature"（应包含 Feature 本体 + 多个子类）
	featureResults := reg.Search("Feature")
	if len(featureResults) < 1 {
		t.Error("Search('Feature') should find at least Feature")
	}
}

// --- 测试 5: classifyByName 推断 ---

func TestClassifyByName(t *testing.T) {
	tests := []struct {
		name string
		want ElementKind
	}{
		{"Block", KindClassifier},
		{"ItemDef", KindClassifier},
		{"ActionDef", KindClassifier},
		{"Attribute", KindFeature},
		{"Port", KindFeature},
		{"Step", KindFeature},
		{"Package", KindNamespace},
		{"LibraryPackage", KindNamespace},
		{"Subclassification", KindRelationship},
		{"Redefinition", KindRelationship},
		{"DataType", KindType},
		{"Structure", KindType},
		{"Unknown", KindElement},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyByName(tt.name)
			if got != tt.want {
				t.Errorf("classifyByName(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

// --- 测试 6: All() 返回所有元素 ---

func TestRegistry_All(t *testing.T) {
	reg, _ := NewMockRegistry()
	all := reg.All()
	if len(all) != reg.Count() {
		t.Errorf("All() returned %d, Count() = %d", len(all), reg.Count())
	}
}
