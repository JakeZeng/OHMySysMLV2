// Package parser: M16 P4/Q23 项目级标准库 —— 自带常用 rendering 名字的 SysML 模板，
// 让历史用法（`render asStateDiagram;` / `render asActionDiagram;` 等）经由合法语法
// 重新表达为 stdlib 里的 rendering def，renderKind 仍能正确路由到对应 renderer。
//
// 官方标准 4：asTextualNotation / asTreeDiagram / asInterconnectionDiagram / asElementTable
// + 历史上 4 个非标准名字：asStateDiagram / asActionDiagram / asRequirementTable / asSnapshotTable
//
// 这 8 个 def 都被注入到每个工程包内容的最顶部（在 `package P { ... }` 之前），
// 使任何 `render <name>` 都能 resolve 到合法 rendering 引用，同时去掉
// `render as <kind>;` 的 legacy 形态。
package parser

// StandardLibrary 模板内容（注入到工程包 content 的开头）。
// 每个 `rendering def` 都是一个完整的、可被 `render rendering def;` 引用或
// `render asName;` 直接引用的 rendering usage（标准库语义）。
const StandardLibrary = `
rendering def asTextualNotation {
    doc /* 官方标准 §7.26 — 文本记法呈现 */
}
rendering def asTreeDiagram {
    doc /* 官方标准 §7.26 — 树形图呈现 */
}
rendering def asInterconnectionDiagram {
    doc /* 官方标准 §7.26 — 互连图呈现 */
}
rendering def asElementTable {
    doc /* 官方标准 §7.26 — 元素表格呈现 */
}
rendering def asStateDiagram {
    doc /* M16 标准库扩展 — 状态机图呈现（历史上非官方） */
}
rendering def asActionDiagram {
    doc /* M16 标准库扩展 — 活动/动作图呈现 */
}
rendering def asRequirementTable {
    doc /* M16 标准库扩展 — 需求表呈现 */
}
rendering def asSnapshotTable {
    doc /* M16 标准库扩展 — 快照表呈现 */
}
`

// KnownRenderers 历史上使用的 8 个渲染器名字（renderKind 推导按末段比较）
var KnownRenderers = []string{
	"asTextualNotation",
	"asTreeDiagram",
	"asInterconnectionDiagram",
	"asElementTable",
	"asStateDiagram",
	"asActionDiagram",
	"asRequirementTable",
	"asSnapshotTable",
}

// IsKnownRenderer 判断 ref（末段）是否在标准库 + 官方 4 之列
func IsKnownRenderer(ref string) bool {
	if ref == "" {
		return false
	}
	last := ref
	if i := lastIndexOf(ref, "::"); i >= 0 {
		last = ref[i+2:]
	}
	for _, k := range KnownRenderers {
		if last == k {
			return true
		}
	}
	return false
}

func lastIndexOf(s, sub string) int {
	for i := len(s) - len(sub); i >= 0; i-- {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}