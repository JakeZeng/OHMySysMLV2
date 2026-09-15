// Package metamodel 加载并提供 SysML v2 元模型查询。
//
// 设计目标见 m3-metamodel-loader-design.md。
// 演进时间线：
//   - M3 W1 c1-d3: 本文件（types）+ registry.go + loader.go
//   - M3 W1 c1-d4: HTTP handler（5 个 endpoint）
//   - M3 W3: 前端元模型浏览器 UI（树形 + 详情）
package metamodel

// ElementKind 是元模型元素的分类。
// 用于按类型过滤 + 决定加载策略。
type ElementKind int

const (
	KindUnknown ElementKind = iota
	KindElement         // 根
	KindClassifier      // Classifier 及其子类（Block/ItemDef/Action/Requirement/...）
	KindFeature         // Feature 及其子类（Attribute/Port/Step/Expression/...）
	KindRelationship    // Relationship 及其子类
	KindNamespace       // Package / LibraryPackage
	KindType            // DataType / Structure
)

// String 返回 ElementKind 的字符串表示。
func (k ElementKind) String() string {
	switch k {
	case KindElement:
		return "element"
	case KindClassifier:
		return "classifier"
	case KindFeature:
		return "feature"
	case KindRelationship:
		return "relationship"
	case KindNamespace:
		return "namespace"
	case KindType:
		return "type"
	default:
		return "unknown"
	}
}

// ParseKind 反向解析 ElementKind。
func ParseKind(s string) ElementKind {
	switch s {
	case "element":
		return KindElement
	case "classifier":
		return KindClassifier
	case "feature":
		return KindFeature
	case "relationship":
		return KindRelationship
	case "namespace":
		return KindNamespace
	case "type":
		return KindType
	default:
		return KindUnknown
	}
}

// Multiplicity 表示元素属性的多重性。
// -1 表示 *（无界）。
type Multiplicity struct {
	LowerBound int
	UpperBound int
}

// IsUnbounded 判断上界是否无界。
func (m Multiplicity) IsUnbounded() bool {
	return m.UpperBound == -1
}

// String 返回 [lower..upper] 格式。
func (m Multiplicity) String() string {
	lower := "*"
	if m.LowerBound != -1 {
		lower = itoa(m.LowerBound)
	}
	upper := "*"
	if m.UpperBound != -1 {
		upper = itoa(m.UpperBound)
	}
	return "[" + lower + ".." + upper + "]"
}

func itoa(n int) string {
	// 简单实现（不依赖 strconv 减体积）
	if n == 0 {
		return "0"
	}
	negative := n < 0
	if negative {
		n = -n
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if negative {
		return "-" + string(digits)
	}
	return string(digits)
}

// MetaProperty 是元素的属性定义。
type MetaProperty struct {
	Name          string
	Type          string  // 字符串类型名（e.g. "string" / "Element" / "Classifier"）
	Multiplicity  Multiplicity
	Documentation string
	Required      bool
	Redefines     string  // 如果是 redefine，父属性名
}

// MetaElement 是元模型元素的内存表示。
// 对应 SysML.json 里 definitions 中的一个 type。
type MetaElement struct {
	QualifiedName string        // e.g. "SysML::Block"
	Name          string        // e.g. "Block"
	Namespace     string        // e.g. "SysML"
	Kind          ElementKind
	Documentation string
	SuperType     string          // 直接父类 qualifiedName
	SubTypes      []string        // 直接子类（启动时反向填充）
	Properties    []MetaProperty  // 属性列表
	Containments  []string        // 可包含的子元素类型
	References    []string        // 可引用的元素类型
}

// IsAbstract 是否抽象（从 Documentation 或 Properties 推断，简化版：看名字前缀）
// SysML v2 实际是 `abstract` 关键字，本字段为 M5 升级用。
func (e *MetaElement) IsAbstract() bool {
	// M3 简化：暂返回 false
	return false
}
