// Package parser: M16 P4 computeExposed(viewBody, exprIndex) ——
// 应用 filter 表达式对 resolved expose 候选逐个求值，返回最终暴露的元素列表。
//
// 评估模型（与 TS 端 expr 引擎一致，Q21 + Q9=C）：
//   - 用 filter 文本通过 expr.TryParseExpr 解析；解析成功即视为有效 filter
//   - 解析失败的 filter 文本退化为「不筛」（全部保留）+ 记 reason
//   - 单个过滤 expression / 对候选逐个 evaluate → true = 入选
//
// 这是 backend 侧对 view 保存路径的入口；前端 modelToFlow 仍以
// ExposedElements 列表为输入（节点头渲染）。双端一致性靠共享 conformance fixture。
package parser

import (
	"fmt"
	"sort"
	"strings"

	"github.com/sysmlv2/mbse-backend/internal/expr"
	"github.com/sysmlv2/mbse-backend/internal/model"
)

// FilteredExposed 暴露元素经 filter 求值后的最终成员（含 line/col 以便画布幽灵节点定位）
type FilteredExposed struct {
	model.ExposedElement
	// 通过 filter 的原因（"matched" / "no filter" / "filter parse failed: ..."）
	MatchedBy string
}

// indexFromPackages 把 PackageRef 列表构建成 expr.Index（kind/qname/typeRef/specializes/metadata/features）。
// M16 P4：与 TS 端 ExprIndex.fromModel 语义一致——双端通过 conformance 验证。
func indexFromPackages(packages []PackageRef) *expr.Index {
	elements := make([]expr.ElementInfo, 0, len(packages)*4)
	// 全局按短名缓存同名候选；类型互连（specializes）通过 qualifiedName 解析。
	for _, p := range packages {
		// 包本身就是 namespace member（model 包 = kind 'package'）
		elements = append(elements, expr.ElementInfo{
			Name:          p.Name,
			QualifiedName: p.Name,
			Kind:          "package",
			Specializes:   []string{},
			Metadata:      []string{},
			Features:      []expr.FeatureInfo{},
		})
		// 包内 def / usage：只做词法扫描（MVP：低频手段；P5+ 接入 Go 解析器）
		if p.HasContent && p.Content != "" {
			scanPackageMembers(p.Name, p.Content, &elements)
		}
	}
	return expr.NewIndex(elements)
}

// scanPackageMembers 轻量级包成员扫描——**legacy 兜底**。
//
// ⚠️ M19 定位：expose 作用域的**权威实现是前端 TS PEG 解析器**
//
//	（views/scope.ts）。浏览器端保存视图时会把算好的作用域随请求送上来
//	（exposedElements / exposedElementsUnresolved），后端直接采用。
//	这个 Go 扫描器只在「客户端没送作用域」时兜底（脚本调用 / 老客户端）。
//
//	所以它**不需要**是完整解析器，但**不能**与 TS 侧差太远 ——
//	两套实现给出不同结论时，树上会出现「⚠ 未解析」徽章，而画布上明明有元素。
//
// M19 修复：原来只扫**包文本的顶层行**，于是
//   - 子包里的元素扫不到（`expose P::Sub::X` 解析不出来）；
//   - 定义体里的成员扫不到（`expose P::X::y` 同理）。
//
// 现在按**花括号深度 + 命名空间栈**跟踪，成员归属到正确的限定名前缀。
func scanPackageMembers(pkgName, src string, out *[]expr.ElementInfo) {
	lines := strings.Split(src, "\n")
	// 命名空间栈：每一项是「成员该挂在哪个限定名前缀下」+「它开启时的花括号深度」。
	type nsFrame struct {
		prefix string
		depth  int
	}
	var stack []nsFrame
	depth := 0

	// 当前成员该用的限定名前缀（栈顶优先，没有则是包本身）
	currentPrefix := func() string {
		if len(stack) == 0 {
			return pkgName
		}
		return stack[len(stack)-1].prefix
	}

	for _, line := range lines {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "//") || strings.HasPrefix(t, "/*") {
			depth += strings.Count(line, "{") - strings.Count(line, "}")
			continue
		}
		// 这一行开头的花括号数（包 / 定义体的 `{` 都在行尾）
		opensBefore := depth

		// ── 1) 包声明 → 压栈（子包的成员属于子包）──
		if strings.HasPrefix(t, "package ") {
			name := strings.TrimPrefix(t, "package ")
			if i := strings.IndexAny(name, " {:;"); i >= 0 {
				name = name[:i]
			}
			name = strings.TrimSpace(name)
			if name != "" && strings.Contains(line, "{") {
				prefix := currentPrefix()
				// ⚠️ 包文本本身就是 `package <包名> { … }`（DB 里存的是整段文本），
				//    所以**最外层**的 package 声明就是这个包自己，不能再拼一次名字
				//    （否则会扫出 `Pkg::Pkg::Vehicle` 这种双前缀）。
				//    只有**嵌套**的子包才追加一段。
				if len(stack) > 0 {
					prefix = prefix + "::" + name
				}
				depth = opensBefore + strings.Count(line, "{")
				stack = append(stack, nsFrame{prefix: prefix, depth: depth})
				continue
			}
		}

		// ── 2) 定义（part def X { … }）→ 压栈，body 成员挂在它下面 ──
		if name, kind, ok := matchDefinition(t); ok && strings.Contains(line, "{") {
			prefix := currentPrefix()
			if prefix != "" {
				prefix = prefix + "::" + name
			} else {
				prefix = name
			}
			depth = opensBefore + strings.Count(line, "{")
			stack = append(stack, nsFrame{prefix: prefix, depth: depth})
			// 定义本身也是一个元素（part def X 是可 expose 的成员）
			*out = append(*out, expr.ElementInfo{
				Name:          name,
				QualifiedName: prefix,
				Kind:          kind,
				Specializes:   []string{},
				Metadata:      []string{},
				Features:      []expr.FeatureInfo{},
			})
			continue
		}

		// ── 3) 普通成员行 ──
		prefix := currentPrefix()

		// def 类（part/port/attribute/item/requirement/constraint/action/state def Name）
		for _, kw := range []string{"part def", "port def", "attribute def", "item def",
			"requirement def", "constraint def", "action def", "state def"} {
			if strings.HasPrefix(t, kw+" ") {
				name := strings.TrimPrefix(t, kw+" ")
				if i := strings.IndexAny(name, " {:;("); i >= 0 {
					name = name[:i]
				}
				name = strings.TrimSpace(name)
				if name != "" {
					kind := capitalize(strings.TrimSuffix(kw, " def")) + "Definition"
					*out = append(*out, expr.ElementInfo{
						Name:          name,
						QualifiedName: joinQName(prefix, name),
						Kind:          kind,
						Specializes:   []string{},
						Metadata:      []string{},
						Features:      []expr.FeatureInfo{},
					})
				}
				break
			}
		}
		// usage 类（part|port name : T; / attribute name : T;）
		for _, prefix2 := range []string{"part ", "port ", "attribute ", "item "} {
			if strings.HasPrefix(t, prefix2) {
				rest := strings.TrimPrefix(t, prefix2)
				if i := strings.Index(rest, " : "); i > 0 {
					name := rest[:i]
					typ := rest[i+3:]
					if j := strings.Index(typ, " {"); j >= 0 {
						typ = typ[:j]
					}
					typ = strings.TrimSuffix(strings.TrimSuffix(typ, ";"), "{")
					typ = strings.TrimSpace(typ)
					name = strings.TrimSpace(name)
					if name != "" && typ != "" {
						usageKind := "Usage"
						if prefix2 == "port " {
							usageKind = "PortUsage"
						}
						*out = append(*out, expr.ElementInfo{
							Name:          name,
							QualifiedName: joinQName(prefix, name),
							Kind:          capitalize(strings.TrimSuffix(prefix2, " ")) + usageKind,
							TypeRef:       &typ,
							Specializes:   []string{},
							Metadata:      []string{},
							Features:      []expr.FeatureInfo{},
						})
					}
				}
				break
			}
		}

		// ── 4) 收尾：更新花括号深度，弹出已经闭合的命名空间 ──
		depth += strings.Count(line, "{") - strings.Count(line, "}")
		for len(stack) > 0 && depth < stack[len(stack)-1].depth {
			stack = stack[:len(stack)-1]
		}
	}
}

// joinQName 拼接限定名（前缀为空时只返回名字）。
func joinQName(prefix, name string) string {
	if prefix == "" {
		return name
	}
	return prefix + "::" + name
}

// matchDefinition 识别 `part def X` / `port def X` 这类定义行。
// 返回 (名字, kind, 是否是定义)。
func matchDefinition(t string) (string, string, bool) {
	for _, kw := range []string{"part def", "port def", "attribute def", "item def",
		"requirement def", "constraint def", "action def", "state def"} {
		if !strings.HasPrefix(t, kw+" ") {
			continue
		}
		name := strings.TrimPrefix(t, kw+" ")
		if i := strings.IndexAny(name, " {:;("); i >= 0 {
			name = name[:i]
		}
		name = strings.TrimSpace(name)
		if name == "" {
			return "", "", false
		}
		return name, capitalize(strings.TrimSuffix(kw, " def")) + "Definition", true
	}
	return "", "", false
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// ComputeExposed 对解析后的 viewBody 与 filter 求值，返回最终暴露的元素（按 qname 排序）。
//
// 实现策略：
//   - 用 packages/* 对全部工程包构建 expr.Index
//   - 对每个 ParsedViewBody.ExposedElements（resolved 列表）：
//   - `P::X::**`  → 展开 X 与其后裔；filter 求值
//   - `P::*::**`  → 展开 P 与其后代嵌套；filter 求值
//   - `P::*`      → 同上但不递归
//   - `P::X`      → 单元素 X
//     unresolved → 不 apply（移交给 getExposedElementsUnresolved）
//   - filter 求值失败的项保留并标记 reason
//   - 去重（同一元素被多 expose 引用时只算一次）
func ComputeExposed(parsed ParsedViewBody, packages []PackageRef) []FilteredExposed {
	idx := indexFromPackages(packages)
	seen := map[string]bool{}
	out := []FilteredExposed{}

	for _, filterText := range parsed.FilterQualifiedNames {
		// 预解析 filter（每个 view 多个 filter 全 OR；P3 阶段：filter 是单个，简化）
		_ = filterText
	}

	for _, exp := range parsed.ExposedElements {
		_ = exp
	}

	// P4 MVP 简化：直接遍历每条 filter，对每个 resolved expose path 收集候选并求值。
	// 当前 ParsedViewBody.FilterQualifiedNames 只保留 filter 文本（同 view 多个 filter AND 语义）。
	for _, exp := range parsed.ExposedElements {
		// 当前 parser 还未把 filter 与具体 expose 路径绑定（filter 是 view 级全局）。
		// 为 MVP，先将每个 resolved expose 路径下的候选元素全部纳入受过滤集合。
		for _, e := range collectCandidates(exp.QualifiedName, idx) {
			if e == nil {
				continue
			}
			if seen[e.QualifiedName] {
				continue
			}
			matched := "no filter"
			keep := true
			for _, fText := range parsed.FilterQualifiedNames {
				parsedExpr := expr.TryParseExpr(fText)
				if parsedExpr.Kind == "" {
					matched = "filter parse failed: " + fText
					keep = true // 退化为「不筛」
					break
				}
				elementInfo := lookupInfo(e, idx)
				if elementInfo == nil {
					continue
				}
				if expr.Evaluate(parsedExpr, elementInfo, idx) == true {
					matched = "matched"
					keep = true
				} else {
					keep = false
				}
				break
			}
			if !keep {
				continue
			}
			seen[e.QualifiedName] = true
			out = append(out, FilteredExposed{
				ExposedElement: model.ExposedElement{
					QualifiedName: e.QualifiedName,
					Kind:          e.Kind,
				},
				MatchedBy: matched,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].QualifiedName < out[j].QualifiedName
	})
	return out
}

// collectCandidates 按官方四形式（`P::X` / `P::X::**` / `P::*` / `P::*::**`）展开候选元素。
func collectCandidates(expQualified string, idx *expr.Index) []*expr.ElementInfo {
	if expQualified == "" {
		return nil
	}
	parts := strings.Split(expQualified, "::")
	// 末段若是 `*` 或 `**`，剥掉（命名空间级暴露）
	wildcard := false
	for len(parts) > 0 {
		last := parts[len(parts)-1]
		if last != "*" && last != "**" {
			break
		}
		wildcard = true
		parts = parts[:len(parts)-1]
	}
	if !wildcard {
		// 单元素 / 路径中的「X」部分
		fullName := expQualified
		// 命名空间链上各段也允许（暴露层级的`m`递归）
		if e := lookupInfo(nil, idx); e != nil {
			_ = e
		}
		if e := exprLookup(idx, fullName); e != nil {
			return []*expr.ElementInfo{e}
		}
		return nil
	}
	// 命名空间级暴露：从命名空间起点开始展开
	prefix := strings.Join(parts, "::")
	if wildcard && strings.HasSuffix(expQualified, "::**") {
		// ** 递归
		return descendants(idx, prefix)
	}
	return directMembers(idx, prefix)
}

// descendants 命名空间 `prefix` 及其后代（pkg → sub-pkg → member → ...）递归
func descendants(idx *expr.Index, prefix string) []*expr.ElementInfo {
	var out []*expr.ElementInfo
	// 直接成员
	out = append(out, directMembers(idx, prefix)...)
	// 子命名空间
	for _, el := range idx.All {
		if el.Kind != "package" {
			continue
		}
		if strings.HasPrefix(el.QualifiedName, prefix+"::") {
			out = append(out, descendants(idx, el.QualifiedName)...)
		}
	}
	return out
}

// directMembers 命名空间 `prefix` 的直接成员（不递归）
func directMembers(idx *expr.Index, prefix string) []*expr.ElementInfo {
	var out []*expr.ElementInfo
	for _, el := range idx.All {
		// pkg 的直接子代：qname 是 prefix + "::" + 名字
		if el.QualifiedName == prefix {
			continue
		}
		if strings.HasPrefix(el.QualifiedName, prefix+"::") {
			seg := strings.TrimPrefix(el.QualifiedName, prefix+"::")
			if !strings.Contains(seg, "::") {
				out = append(out, el)
			}
		}
	}
	return out
}

// exprLookup 通过 qname 或裸名在索引中查找
func exprLookup(idx *expr.Index, name string) *expr.ElementInfo {
	if e := idx.Resolve(name); e != nil {
		return e
	}
	return nil
}

// lookupInfo 在 result slice 里找 ElementInfo（已收集到的引用对象 → 索引）
func lookupInfo(el *expr.ElementInfo, _ *expr.Index) *expr.ElementInfo {
	return el
}

// 编译时引用提示（静默用）
var _ = fmt.Sprintf
