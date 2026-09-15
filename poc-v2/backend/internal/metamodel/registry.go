package metamodel

import (
	"strings"
	"sync"
	"time"
)

// Registry 是元模型元素的内存注册表。
// 启动时一次性加载；运行时只读 + 线程安全。
type Registry struct {
	mu        sync.RWMutex
	elements  map[string]*MetaElement  // by QualifiedName
	byKind    map[ElementKind][]*MetaElement
	subtypes  map[string][]string        // qname → 直接子类 qname 列表
	loaded    time.Time
	source    string  // 数据源标识（文件路径或 "mock"）
}

// NewRegistry 创建空 Registry。
func NewRegistry() *Registry {
	return &Registry{
		elements: make(map[string]*MetaElement),
		byKind:   make(map[ElementKind][]*MetaElement),
		subtypes: make(map[string][]string),
	}
}

// Add 添加一个元素到 Registry。
// Loader 内部使用；外部不应直接调用。
// 重复 QualifiedName 会覆盖。
func (r *Registry) Add(e *MetaElement) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 推断 Kind（如果未设）
	if e.Kind == KindUnknown {
		e.Kind = classifyByName(e.Name)
	}

	r.elements[e.QualifiedName] = e
	r.byKind[e.Kind] = append(r.byKind[e.Kind], e)

	// 反向填充 SubTypes
	if e.SuperType != "" {
		r.subtypes[e.SuperType] = append(r.subtypes[e.SuperType], e.QualifiedName)
	}
}

// classifyByName 根据元素名推断 Kind。
// M3 简化版：按命名约定。
//   - "Block" / "ItemDef" / "Action" / "Requirement" → Classifier
//   - "Attribute" / "Port" / "Step" / "Reference" → Feature
//   - "Package" / "LibraryPackage" → Namespace
//   - "Subclassification" / "Subsetting" → Relationship
//   - "DataType" / "Structure" / "Association" → Type
func classifyByName(name string) ElementKind {
	switch {
	case strings.HasSuffix(name, "Def"):
		return KindClassifier
	case name == "Attribute" || name == "Port" || name == "Step" ||
		name == "Reference" || name == "Expression" || name == "ItemFeature":
		return KindFeature
	case name == "Package" || name == "LibraryPackage":
		return KindNamespace
	case strings.HasPrefix(name, "Sub") || strings.HasPrefix(name, "Redefinition") ||
		strings.HasPrefix(name, "FeatureChaining") || strings.HasPrefix(name, "TypeFeaturing"):
		return KindRelationship
	case name == "DataType" || name == "Structure" || name == "Association" ||
		name == "Enumeration":
		return KindType
	default:
		return KindElement
	}
}

// Get 按 QualifiedName 查询元素。
func (r *Registry) Get(qname string) (*MetaElement, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.elements[qname]
	return e, ok
}

// ByKind 按 Kind 过滤元素。
func (r *Registry) ByKind(k ElementKind) []*MetaElement {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*MetaElement, len(r.byKind[k]))
	copy(out, r.byKind[k])
	return out
}

// SubTypesOf 返回指定元素的所有直接子类。
func (r *Registry) SubTypesOf(qname string) []*MetaElement {
	r.mu.RLock()
	defer r.mu.RUnlock()
	qnames := r.subtypes[qname]
	out := make([]*MetaElement, 0, len(qnames))
	for _, qn := range qnames {
		if e, ok := r.elements[qn]; ok {
			out = append(out, e)
		}
	}
	return out
}

// All 返回所有元素。
func (r *Registry) All() []*MetaElement {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*MetaElement, 0, len(r.elements))
	for _, e := range r.elements {
		out = append(out, e)
	}
	return out
}

// Count 返回元素总数。
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.elements)
}

// Search 按 name 子串模糊查询。
// 简单实现：name 或 qualifiedName 包含 query。
func (r *Registry) Search(query string) []*MetaElement {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []*MetaElement{}
	for _, e := range r.elements {
		if strings.Contains(strings.ToLower(e.Name), strings.ToLower(query)) ||
			strings.Contains(strings.ToLower(e.QualifiedName), strings.ToLower(query)) {
			out = append(out, e)
		}
	}
	return out
}

// Source 返回数据源标识。
func (r *Registry) Source() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.source
}

// LoadedAt 返回加载时间。
func (r *Registry) LoadedAt() time.Time {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.loaded
}

// SetSource 设置数据源标识（Loader 内部使用）。
func (r *Registry) SetSource(s string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.source = s
	r.loaded = time.Now()
}
