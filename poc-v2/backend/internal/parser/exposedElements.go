// Package parser 提供 SysML v2 文本的轻量级解析能力（M12）。
//
// 当前 MVP 只支持：
//   - `expose A::B::C;`            单行 expose（成员访问）
//   - `view V { expose A::B; }`    view 块内的 expose
//   - `package P { part def X { ... } }` 等成员定义（用于推断 kind）
//
// 不做完整 AST/语义校验；只产出 exposedElements 列表缓存。
package parser

import (
	"regexp"
	"strings"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// exposeLine 匹配 `expose` 语句及其后面的路径。
//   - 容忍前导空白（缩进）、任意中间空白；
//   - 路径名段必须以字母或下划线开头（兼容 SysML 标识符规则）。
//   - `::` 是 SysML v2 限域符；也兼容 `.`（宽松解析）。
var (
	// 分隔符：双冒号 `::` 或单点 `.`，中间允许任意空白。
	exposePathRe = regexp.MustCompile(`\bexpose\b\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*(?:::|\.)\s*[A-Za-z_][A-Za-z0-9_]*)+)\s*;`)

	// kindKeywords 形如 `part def`、`port def`、`action def` 等定义关键字。
	// 用于把路径最后一段标上 kind（粗略分类）。
	kindKeywords = []struct {
		kw  string
		cat string
	}{
		{"part def", "PartDef"},
		{"port def", "PortDef"},
		{"action def", "ActionDef"},
		{"state def", "StateDef"},
		{"requirement def", "RequirementDef"},
		{"constraint def", "ConstraintDef"},
		{"connection def", "ConnectionDef"},
		{"interface def", "InterfaceDef"},
		{"item def", "ItemDef"},
		{"attribute def", "AttributeDef"},
		{"occurrence def", "OccurrenceDef"},
		{"connection", "ConnectionUsage"},
		{"part", "PartUsage"},
		{"port", "PortUsage"},
		{"action", "ActionUsage"},
		{"state", "StateUsage"},
		{"requirement", "RequirementUsage"},
		{"constraint", "ConstraintUsage"},
		{"item", "ItemUsage"},
		{"attribute", "AttributeUsage"},
		{"ref", "ReferenceUsage"},
	}
)

// ParseExposedElements 解析 view content，返回暴露的元素列表。
// 实现要点：
//   - 每条 `expose Path::To::Element;` 都对应一条记录
//   - 同一路径出现多次会去重（map 去重）
//   - kind 推断：在元素定义所在行做关键字匹配（粗略）
//   - 空内容或无 expose → 返回 nil（视作空视图）
func ParseExposedElements(content string) []model.ExposedElement {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	out := make([]model.ExposedElement, 0, 4)
	seen := make(map[string]struct{}, 4)
	matches := exposePathRe.FindAllStringSubmatch(content, -1)
	for _, m := range matches {
		raw := strings.TrimSpace(m[1])
		// 把中间 ` . ` 或 `::` 全部统一为 `::`
		normalized := normalizePath(raw)
		if normalized == "" {
			continue
		}
		if _, dup := seen[normalized]; dup {
			continue
		}
		seen[normalized] = struct{}{}
		kind := inferKind(content, normalized)
		out = append(out, model.ExposedElement{
			QualifiedName: normalized,
			Kind:          kind,
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// normalizePath 把 `A.B.C` 或 `A :: B :: C` 统一为 `A::B::C`，并修剪空白。
func normalizePath(p string) string {
	// 先把所有空白去掉（容忍 `A :: B`）
	noSpace := strings.Join(strings.Fields(p), "")
	noSpace = strings.ReplaceAll(noSpace, ".", "::")
	if noSpace == "" {
		return ""
	}
	return noSpace
}

// inferKind 尝试在 content 中查找定义语句，把最后一个 segment 的 kind 推断出来。
//
// 仅当同一个 content 中存在 `part def X` / `action def Y` 等定义语句时，
// 且暴露元素路径的最后一段与之匹配，才返回相应 kind；
// 否则返回空字符串（"unknown"，留待前端 UI 决定如何显示）。
//
// 注意：MVP 不做完整 AST/语义校验；不做路径解析（无法知道 `Pkg1::Vehicle`
// 是否真的指向 `part def Vehicle`，除非同 content 中存在该定义）。
func inferKind(content, qualifiedName string) string {
	segments := strings.Split(qualifiedName, "::")
	if len(segments) == 0 {
		return ""
	}
	last := strings.ToLower(segments[len(segments)-1])
	if last == "" {
		return ""
	}
	// 在 content 中找包含 `xxx <last>` 形态的定义语句
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		low := strings.ToLower(line)
		if !strings.Contains(low, last) {
			continue
		}
		for _, kw := range kindKeywords {
			if strings.Contains(low, kw.kw) {
				return kw.cat
			}
		}
	}
	return ""
}
