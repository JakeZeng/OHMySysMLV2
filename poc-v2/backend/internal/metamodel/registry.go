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
//
// Kind 推断推迟到 ClassifyAll()（因为需要 SuperType 信息）。
func (r *Registry) Add(e *MetaElement) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.elements[e.QualifiedName] = e

	// 反向填充 SubTypes（如果 SuperType 已知）
	if e.SuperType != "" {
		r.subtypes[e.SuperType] = append(r.subtypes[e.SuperType], e.QualifiedName)
	}
}

// ClassifyAll 在所有元素 + SuperType 关系建立后调用，
// 根据 SuperType 和 Name 推断每个元素的 Kind。
func (r *Registry) ClassifyAll() {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, e := range r.elements {
		if e.Kind == KindUnknown {
			e.Kind = classifyByName(e.Name, e.SuperType)
		}
		r.byKind[e.Kind] = append(r.byKind[e.Kind], e)
	}
}

// LinkSubType 在 SuperType 关系已知后，建立反向索引 parent → child。
// Loader 内部使用；外部不应直接调用。
func (r *Registry) LinkSubType(parentQname, childQname string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.subtypes[parentQname] = append(r.subtypes[parentQname], childQname)
}

// classifyByName 根据元素名 + 父类推断 Kind。
// 优先级：
//   1. 父类名（更准确）：Classifier / Feature / Namespace / Relationship / DataType 子类
//   2. 名字后缀启发式
//   3. 默认 KindElement
func classifyByName(name, superType string) ElementKind {
	// 1. 按父类推断（最准）
	if superType != "" {
		parentName := extractLastSegment(superType)
		switch parentName {
		case "Classifier", "Block", "ItemDef":
			return KindClassifier
		case "Feature", "Attribute", "Port":
			return KindFeature
		case "Namespace", "Package":
			return KindNamespace
		case "Relationship":
			return KindRelationship
		case "DataType":
			return KindType
		}
	}

	// 2. 按命名约定启发式
	switch {
	case strings.HasSuffix(name, "Def"):
		return KindClassifier
	case name == "Block":
		// Block 是 SysML v2 最常见的 Classifier；无 superType 时也识别为 Classifier
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

// extractLastSegment 返回 "Foo::Bar" → "Bar"
func extractLastSegment(qname string) string {
	for i := len(qname) - 1; i >= 0; i-- {
		if i+1 < len(qname) && qname[i] == ':' && qname[i+1] == ':' {
			return qname[i+2:]
		}
	}
	return qname
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
