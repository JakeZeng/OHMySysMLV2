// Package parser 提供 SysML v2 文本的轻量级解析能力。
//
// M15 升级：view body 解析从单子句（仅 expose）扩展到完整子句集：
//   - `expose A::B::C;`              跨包引用
//   - `render as <kind>;`            渲染方式（interconnection/tree/...）
//   - `filter @X::Y;`                元类过滤
//   - `view Name satisfies VP;`      满足的 Viewpoint
//   - body 内嵌 def（part def X / requirement def Y 等） → InnerElement
//
// 路径 resolve：handler 层传入 projectPackages，验证 expose 路径是否能定位到包内 def。
// resolved 列表与 unresolved 列表分离（带 reason）。
package parser

import (
	"regexp"
	"strings"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── 正则定义 ─────────────────────────────────────────────────────────

var (
	// expose 路径：`expose A::B::C;` 或 `expose A.B.C;`
	exposePathRe = regexp.MustCompile(`\bexpose\b\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*(?:::|\.)\s*[A-Za-z_][A-Za-z0-9_]*)+)\s*;`)

	// render 子句：`render as <kind>;`
	renderAsRe = regexp.MustCompile(`\brender\s+as\s+(tree|interconnection|state|action|requirement|snapshot)\s*;`)

	// filter 子句：`filter @X::Y;`
	filterAtRe = regexp.MustCompile(`\bfilter\s+@([A-Za-z_][A-Za-z0-9_]*(?:\s*(?:::|\.)\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*;`)

	// satisfies 子句：`view Name satisfies X::Y;`（顶层 view usage 形式）
	// 注意：必须位于 view body 内；用简单的关键字前后空白匹配
	satisfiesRe = regexp.MustCompile(`\bview\s+([A-Za-z_][A-Za-z0-9_]*)\s+satisfies\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*(?:::|\.)\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\{`)

	// 内嵌元素定义（简化版）
	// 匹配 `part def X { ... }` / `port def X` / `requirement def X` 等
	innerDefRe = regexp.MustCompile(`(?m)^\s*(part|port|action|state|requirement|constraint|item|attribute|connection)\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\s*[{;]`)

	// 关键字分类表
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

// ─── 解析结果 ────────────────────────────────────────────────────────

// ParsedViewBody view body 完整解析结果。
type ParsedViewBody struct {
	// 满足的 Viewpoint qualified name
	SatisfiesQualifiedName string
	// 暴露元素（已 resolve）
	ExposedElements []model.ExposedElement
	// 未 resolve 的 expose 元素（带 reason）
	ExposedElementsUnresolved []model.ExposedElement
	// 渲染方式
	RenderKind model.RenderKind
	// 过滤规则（qualified name 列表）
	FilterQualifiedNames []string
	// view body 内嵌 owned 元素
	InnerElements []model.InnerElement
}

// ─── 入口 ────────────────────────────────────────────────────────────

// ParseViewBody 完整解析 view body（无 resolve 信息）。
//
// 适用于本地预览/语法解析；handler 层应用 ParseViewBodyWithPackages 做 resolve 校验。
func ParseViewBody(content string) ParsedViewBody {
	out := ParsedViewBody{
		RenderKind: model.RenderKindInterconnection,
	}
	if strings.TrimSpace(content) == "" {
		return out
	}

	// 1. render as
	if m := renderAsRe.FindStringSubmatch(content); m != nil {
		out.RenderKind = model.RenderKind(m[1])
	}

	// 2. filter @
	filterMatches := filterAtRe.FindAllStringSubmatch(content, -1)
	seenFilter := map[string]struct{}{}
	for _, m := range filterMatches {
		fqn := normalizePath(m[1])
		if fqn == "" {
			continue
		}
		if _, dup := seenFilter[fqn]; dup {
			continue
		}
		seenFilter[fqn] = struct{}{}
		out.FilterQualifiedNames = append(out.FilterQualifiedNames, fqn)
	}

	// 3. satisfies
	if m := satisfiesRe.FindStringSubmatch(content); m != nil {
		out.SatisfiesQualifiedName = normalizePath(m[2])
	}

	// 4. 内嵌元素定义
	innerMatches := innerDefRe.FindAllStringSubmatch(content, -1)
	seenInner := map[string]struct{}{}
	for _, m := range innerMatches {
		kw := strings.ToLower(strings.TrimSpace(m[1]))
		name := strings.TrimSpace(m[2])
		if name == "" {
			continue
		}
		if _, dup := seenInner[name]; dup {
			continue
		}
		seenInner[name] = struct{}{}
		// 把 `part def` 等映射成具体 kind
		kind := strings.ToUpper(kw[:1]) + kw[1:] + "Def"
		out.InnerElements = append(out.InnerElements, model.InnerElement{
			Name: name,
			Kind: kind,
			Line: 0, // MVP 不计算精确行号
			Col:  0,
		})
	}

	// 5. expose（resolved/unresolved 拆分）
	exposeMatches := exposePathRe.FindAllStringSubmatch(content, -1)
	seenExpose := map[string]struct{}{}
	for _, m := range exposeMatches {
		raw := strings.TrimSpace(m[1])
		normalized := normalizePath(raw)
		if normalized == "" {
			continue
		}
		if _, dup := seenExpose[normalized]; dup {
			continue
		}
		seenExpose[normalized] = struct{}{}
		kind := inferKind(content, normalized)
		out.ExposedElements = append(out.ExposedElements, model.ExposedElement{
			QualifiedName: normalized,
			Kind:          kind,
		})
	}

	return out
}

// ParseViewBodyWithPackages 解析 + 跨包路径 resolve 校验。
//
// packages：工程下所有包的（ID, Name, ParentPackageID, Content）信息。
// 返回：resolved 元素、未 resolved 元素（带 Reason）。
//
// resolve 策略（M15 严格版）：
//   - 把 `A::B::C` 拆成 [A, B, C]
//   - 在 packages 中找到 name == A 的顶级包（parent_package_id 为空）
//   - 中间段递归下钻子包：找 name == B 且 parent == A 的子包
//   - 最后一段 C 必须是**目标包 body 内真实定义的 def/usage**（否则 unresolved）
//   - resolved 时 Kind 取自包 body 中的实际定义（part def → PartDef）
//
// 中间段仍只按包链匹配（不把嵌套 usage 当 namespace）——这是 MVP 边界，
// 见 plan 风险表；最后一段的严格校验已足以让树上的 resolve 徽章有意义。
func ParseViewBodyWithPackages(content string, packages []PackageRef) ParsedViewBody {
	parsed := ParseViewBody(content)

	// 子节点索引：parentID → children
	childrenOf := make(map[string][]PackageRef, len(packages))
	for _, p := range packages {
		childrenOf[p.ParentPackageID] = append(childrenOf[p.ParentPackageID], p)
	}

	resolved := make([]model.ExposedElement, 0, len(parsed.ExposedElements))
	unresolved := make([]model.ExposedElement, 0)

	for _, el := range parsed.ExposedElements {
		kind, reason, ok := resolvePath(el.QualifiedName, childrenOf)
		if ok {
			el.Kind = kind // 用包 body 里的真实定义覆盖启发式推断
			resolved = append(resolved, el)
			continue
		}
		el.Reason = reason
		unresolved = append(unresolved, el)
	}

	parsed.ExposedElements = resolved
	parsed.ExposedElementsUnresolved = unresolved
	return parsed
}

// PackageRef 是解析器所需的最小包信息。
type PackageRef struct {
	ID              string
	Name            string
	ParentPackageID string
	// Content 是包的 SysML v2 文本；resolve 最后一段 def 时必须。
	Content string
	// HasContent 区分「body 已知且为空」与「body 未知（调用方只传了摘要）」。
	//
	// 二者语义完全不同：
	//   - HasContent=true 且 Content="" → 包确实是空的，任何 def 都解析不到 → unresolved
	//   - HasContent=false               → 无法判定，退化为只校验包链
	// 若不区分，空包会错误地把任意路径判成 resolved。
	HasContent bool
}

// FromPackages 把 []model.Package 转换为 []PackageRef。
// 非空 Content 视为「body 已知」。
func FromPackages(pkgs []model.Package) []PackageRef {
	out := make([]PackageRef, len(pkgs))
	for i, p := range pkgs {
		out[i] = PackageRef{
			ID:              p.ID,
			Name:            p.Name,
			ParentPackageID: p.ParentPackageID,
			Content:         p.Content,
			HasContent:      p.Content != "",
		}
	}
	return out
}

// FromPackageSummaries 把 []model.PackageSummary 转换为 []PackageRef。
// 摘要不带 Content → HasContent=false，resolve 退化为只校验包链。
func FromPackageSummaries(pkgs []model.PackageSummary) []PackageRef {
	out := make([]PackageRef, len(pkgs))
	for i, p := range pkgs {
		out[i] = PackageRef{ID: p.ID, Name: p.Name, ParentPackageID: p.ParentPackageID}
	}
	return out
}

// FromPackageContentRefs 把 []model.PackageContentRef 转换为 []PackageRef。
// 该路径是「body 已知」的正规入口（handler 用它做严格 resolve）。
func FromPackageContentRefs(refs []model.PackageContentRef) []PackageRef {
	out := make([]PackageRef, len(refs))
	for i, r := range refs {
		out[i] = PackageRef{
			ID:              r.ID,
			Name:            r.Name,
			ParentPackageID: r.ParentPackageID,
			Content:         r.Content,
			HasContent:      true,
		}
	}
	return out
}

// resolvePath 沿包链下钻并校验最后一段 def 是否真实存在。
//
// 返回 (kind, reason, ok)：
//   - ok=true  → kind 为目标 def 的实际种类（可能为空串，表示无法判定但路径存在）
//   - ok=false → reason 说明失败在哪一段
func resolvePath(qualifiedName string, childrenOf map[string][]PackageRef) (string, string, bool) {
	segments := strings.Split(qualifiedName, "::")
	if len(segments) < 2 {
		return "", "qualified name must be at least Pkg::Element", false
	}

	// 第一段：顶级包
	current, found := findChildByName(childrenOf[""], segments[0])
	if !found {
		return "", "top-level package not found: " + segments[0], false
	}

	// 中间段：嵌套包（除最后一段）
	for i := 1; i < len(segments)-1; i++ {
		current, found = findChildByName(childrenOf[current.ID], segments[i])
		if !found {
			return "", "nested package not found: " + segments[i], false
		}
	}

	defName := segments[len(segments)-1]
	// body 未知的调用方（仅传摘要）：退化为只校验包链
	if !current.HasContent {
		return "", "", true
	}
	kind := findDefKind(current.Content, defName)
	if kind == "" {
		return "", "definition not found in package " + current.Name + ": " + defName, false
	}
	return kind, "", true
}

// findChildByName 在候选包中按名查找。
func findChildByName(candidates []PackageRef, name string) (PackageRef, bool) {
	for _, p := range candidates {
		if p.Name == name {
			return p, true
		}
	}
	return PackageRef{}, false
}

// defKindRe 匹配包 body 内的元素定义，捕获 (关键字, 是否 def, 名字)。
// 例：`part def Vehicle` → ("part", "def ", "Vehicle")；`port p1` → ("port", "", "p1")
var defKindRe = regexp.MustCompile(`(?m)\b(part|port|action|state|requirement|constraint|item|attribute|connection|interface|occurrence)\s+(def\s+)?([A-Za-z_][A-Za-z0-9_]*)\b`)

// findDefKind 在包 content 中查找名为 name 的定义，返回其种类（PartDef / PortUsage / ...）。
// 未找到返回空串。
func findDefKind(content, name string) string {
	if content == "" || name == "" {
		return ""
	}
	for _, m := range defKindRe.FindAllStringSubmatch(content, -1) {
		if m[3] != name {
			continue
		}
		kw := strings.ToLower(m[1])
		suffix := "Usage"
		if strings.TrimSpace(m[2]) != "" {
			suffix = "Def"
		}
		return strings.ToUpper(kw[:1]) + kw[1:] + suffix
	}
	return ""
}

// ─── 工具函数 ────────────────────────────────────────────────────────

// normalizePath 把 `A.B.C` 或 `A :: B :: C` 统一为 `A::B::C`，并修剪空白。
func normalizePath(p string) string {
	if p == "" {
		return ""
	}
	noSpace := strings.Join(strings.Fields(p), "")
	noSpace = strings.ReplaceAll(noSpace, ".", "::")
	if noSpace == "" {
		return ""
	}
	return noSpace
}

// inferKind 在 content 中查找定义语句，把最后一段映射到 kind。
func inferKind(content, qualifiedName string) string {
	segments := strings.Split(qualifiedName, "::")
	if len(segments) == 0 {
		return ""
	}
	last := strings.ToLower(segments[len(segments)-1])
	if last == "" {
		return ""
	}
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