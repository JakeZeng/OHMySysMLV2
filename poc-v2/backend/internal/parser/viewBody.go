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
// packages：工程下所有包的（ID, Name, ParentPackageID）信息。
// 返回：resolved 元素、未 resolved 元素（带 Reason）。
//
// resolve 策略（M15 MVP）：
//   - 把 `A::B::C` 拆成 [A, B, C]
//   - 在 packages 中找到 name == A 的顶级包（parent_package_id 为空）
//   - 递归下钻：找 name == B 且 parent == A 的子包
//   - 最后一段（C）作为 def 名；只要路径前缀合法就算 resolved（def 是否真存在不严格校验）
//
// 严格校验需解析各 package content；M15 简化：只校验路径前缀是否存在。
func ParseViewBodyWithPackages(content string, packages []PackageRef) ParsedViewBody {
	parsed := ParseViewBody(content)

	// 子节点索引：parentID → children
	childrenOf := make(map[string][]PackageRef, len(packages))
	for _, p := range packages {
		pp := p.ParentPackageID
		if pp == "" {
			pp = ""
		}
		childrenOf[pp] = append(childrenOf[pp], p)
	}

	resolved := make([]model.ExposedElement, 0, len(parsed.ExposedElements))
	unresolved := make([]model.ExposedElement, 0)

	for _, el := range parsed.ExposedElements {
		if pathExists(el.QualifiedName, childrenOf) {
			resolved = append(resolved, el)
		} else {
			unresolved = append(unresolved, model.ExposedElement{
				QualifiedName: el.QualifiedName,
				Kind:          el.Kind,
				Reason:        "path not found in project package tree",
			})
		}
	}

	parsed.ExposedElements = resolved
	parsed.ExposedElementsUnresolved = unresolved
	return parsed
}

// PackageRef 是解析器所需的最小包信息（model.Package 与 model.PackageSummary 都满足）。
type PackageRef struct {
	ID              string
	Name            string
	ParentPackageID string
}

// FromPackages 把 []model.Package 转换为 []PackageRef。
func FromPackages(pkgs []model.Package) []PackageRef {
	out := make([]PackageRef, len(pkgs))
	for i, p := range pkgs {
		out[i] = PackageRef{ID: p.ID, Name: p.Name, ParentPackageID: p.ParentPackageID}
	}
	return out
}

// FromPackageSummaries 把 []model.PackageSummary 转换为 []PackageRef。
func FromPackageSummaries(pkgs []model.PackageSummary) []PackageRef {
	out := make([]PackageRef, len(pkgs))
	for i, p := range pkgs {
		out[i] = PackageRef{ID: p.ID, Name: p.Name, ParentPackageID: p.ParentPackageID}
	}
	return out
}

// pathExists 检查 qualified name 路径是否能从顶级包下钻到 def。
// 简化：只校验路径前缀（包链）；最后一段（def name）不强制存在。
func pathExists(qualifiedName string, childrenOf map[string][]PackageRef) bool {
	segments := strings.Split(qualifiedName, "::")
	if len(segments) == 0 {
		return false
	}

	// 第一段：顶级包
	topLevel := childrenOf[""]
	var current PackageRef
	found := false
	for _, p := range topLevel {
		if p.Name == segments[0] {
			current = p
			found = true
			break
		}
	}
	if !found {
		return false
	}

	// 中间段：嵌套包（除最后一段）
	for i := 1; i < len(segments)-1; i++ {
		segment := segments[i]
		kids := childrenOf[current.ID]
		found = false
		for _, p := range kids {
			if p.Name == segment {
				current = p
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	// 最后一段是 def 名（M15 不严格校验 def 是否真存在）
	return true
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