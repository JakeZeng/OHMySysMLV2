// Package expr — M16 P3 KerML 表达式引擎（双端一致性：TS 镜像 poc-v2/expr）。
//
// 双端约束：
//   - AST JSON 形状 ↔ poc-v2/expr/ast.ts（字段、kind 字符串、布尔/数字/字符串值）
//   - 共享 fixture: tests/fixtures/expr-conformance.json（Go 测试也读同一份）
//   - 任何字段/语义修改必须两端同步（M15 两套解析器的教训，Q24）
//
// 语义基线（KerML §7.4 / §8.4.22，POC 边界）：
//   @X   self 元数据命中（末段比较）
//   @@X  self 类型链上**任一**定义的元数据命中
//   istype T (all?)   direct type vs 类型链命中
//   hastype T (all?)   self 拥有类型化到 T 的特征
//   all T    工程内 typeRef 链命中 T 的全部 usage
package expr

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

// ─── AST ────────────────────────────────────────────────────────────────

type Expr struct {
	Kind       string  `json:"kind"`
	Value      *any    `json:"value,omitempty"`        // literal
	Name       *string `json:"name,omitempty"`         // ref/meta/istype/hastype/cast/all
	Target     *string `json:"target,omitempty"`       // istype/hastype/cast
	All        *bool   `json:"all,omitempty"`          // istype/hastype
	MetaMeta   *bool   `json:"metaMeta,omitempty"`     // meta
	Op         *string `json:"op,omitempty"`           // binary
	Left       *Expr   `json:"left,omitempty"`
	Right      *Expr   `json:"right,omitempty"`
	Arg        *Expr   `json:"arg,omitempty"`
	Low        *Expr   `json:"low,omitempty"`
	High       *Expr   `json:"high,omitempty"`
	Base       *Expr   `json:"base,omitempty"`
	Path       []string `json:"path,omitempty"`
	Cond       *Expr   `json:"cond,omitempty"`
	Then       *Expr   `json:"then,omitempty"`
	Els        *Expr   `json:"els,omitempty"`
	Type       *string `json:"type,omitempty"`         // all / cast
	Mode       *string `json:"mode,omitempty"`         // cast
}

func litExpr(v any) Expr     { return Expr{Kind: "literal", Value: &v} }
func refExpr(n string) Expr   { return Expr{Kind: "ref", Name: &n} }
func metaExpr(n string, metaMeta bool) Expr {
	return Expr{Kind: "meta", Name: &n, MetaMeta: &metaMeta}
}
func istypeExpr(t string, all bool) Expr {
	return Expr{Kind: "istype", Target: &t, All: &all}
}
func hastypeExpr(t string, all bool) Expr {
	return Expr{Kind: "hastype", Target: &t, All: &all}
}
func notExpr(a Expr) Expr           { return Expr{Kind: "not", Arg: &a} }
func binExpr(op string, l, r Expr) Expr {
	return Expr{Kind: "binary", Op: &op, Left: &l, Right: &r}
}
func rangeExpr(lo, hi Expr) Expr   { return Expr{Kind: "range", Low: &lo, High: &hi} }
func chainExpr(b Expr, path []string) Expr {
	return Expr{Kind: "chain", Base: &b, Path: path}
}
func condExpr(c, t, e Expr) Expr   { return Expr{Kind: "cond", Cond: &c, Then: &t, Els: &e} }
func coalExpr(l, r Expr) Expr      { return Expr{Kind: "coalesce", Left: &l, Right: &r} }
func allExpr(t string) Expr        { return Expr{Kind: "all", Type: &t} }
func castExpr(mode string, a Expr, t string) Expr {
	return Expr{Kind: "cast", Mode: &mode, Arg: &a, Type: &t}
}

// ─── 词法 ──────────────────────────────────────────────────────────────

type tokKind int

const (
	tkNum tokKind = iota
	tkStr
	tkBool
	tkNull
	tkName
	tkOp
	tkKW
	tkEOF
)

type token struct {
	kind tokKind
	text string
	val  any // literal value (string/bool/null)
	pos  int
}

var keywords = map[string]bool{
	"if": true, "then": true, "else": true,
	"or": true, "xor": true, "and": true, "implies": true,
	"not": true, "istype": true, "hastype": true,
	"all": true, "as": true, "meta": true,
	"true": true, "false": true, "null": true,
}

var ops = []string{
	"===", "!==", "**", "??",
	"==", "!=", "<=", ">=", "..",
	"<", ">", "+", "-", "*", "/", "%", "^", "|", "&",
	"(", ")", ".", "@@", "@",
}

func lex(src string) ([]token, error) {
	var toks []token
	i := 0
	for i < len(src) {
		c := src[i]
		if unicode.IsSpace(rune(c)) {
			i++
			continue
		}
		// 双引号字符串
		if c == '"' {
			j := i + 1
			var sb strings.Builder
			for j < len(src) && src[j] != '"' {
				if src[j] == '\\' && j+1 < len(src) {
					sb.WriteByte(src[j+1])
					j += 2
					continue
				}
				sb.WriteByte(src[j])
				j++
			}
			if j >= len(src) {
				return nil, fmt.Errorf("未闭合的字符串字面量 @ %d", i)
			}
			toks = append(toks, token{tkStr, src[i : j+1], sb.String(), i})
			i = j + 1
			continue
		}
		// 数字（整数或小数，至多一个小数点；小数点后必须跟数字）
		if c >= '0' && c <= '9' {
			j := i + 1
			for j < len(src) && src[j] >= '0' && src[j] <= '9' {
				j++
			}
			if j < len(src) && src[j] == '.' && j+1 < len(src) && src[j+1] >= '0' && src[j+1] <= '9' {
				j++
				for j < len(src) && src[j] >= '0' && src[j] <= '9' {
					j++
				}
			}
			n, err := strconv.ParseFloat(src[i:j], 64)
			if err != nil {
				return nil, fmt.Errorf("无效数字 @ %d", i)
			}
			toks = append(toks, token{tkNum, src[i:j], n, i})
			i = j
			continue
		}
		// 名字 / 关键字 / 限定名
		if isNameStart(c) {
			j := i
			for j < len(src) && (isNamePart(src[j]) || src[j] == ':') {
				j++
			}
			raw := src[i:j]
			norm := strings.ReplaceAll(raw, " ", "")
			// 处理 `::` 间的空白：扫描时已吃进，连字符应进 norm
			norm = collapseDoubleColon(raw)
			if norm == "true" {
				toks = append(toks, token{tkBool, raw, true, i})
			} else if norm == "false" {
				toks = append(toks, token{tkBool, raw, false, i})
			} else if norm == "null" {
				toks = append(toks, token{tkNull, raw, nil, i})
			} else if keywords[norm] {
				toks = append(toks, token{tkKW, norm, nil, i})
			} else {
				toks = append(toks, token{tkName, norm, nil, i})
			}
			i = j
			continue
		}
		// 单引号名字
		if c == '\'' {
			j := i + 1
			for j < len(src) && src[j] != '\'' {
				j++
			}
			if j >= len(src) {
				return nil, fmt.Errorf("未闭合的引号名 @ %d", i)
			}
			// 单引号名后可能接 `::`，需完整吞掉
			k := j + 1
			for k < len(src) && src[k] == ':' && k+1 < len(src) && src[k+1] == ':' {
				k += 2
				if k < len(src) && src[k] == '\'' {
					kk := k + 1
					for kk < len(src) && src[kk] != '\'' {
						kk++
					}
					if kk >= len(src) {
						return nil, fmt.Errorf("未闭合的引号名 @ %d", k)
					}
					k = kk + 1
				} else if k < len(src) && isNameStart(src[k]) {
					kk := k
					for kk < len(src) && isNamePart(src[kk]) {
						kk++
					}
					k = kk
				}
			}
			toks = append(toks, token{tkName, stripQuotes(src[i:k]), nil, i})
			i = k
			continue
		}
		// 运算符（长优先）
		var matched bool
		for _, op := range ops {
			if strings.HasPrefix(src[i:], op) {
				toks = append(toks, token{tkOp, op, nil, i})
				i += len(op)
				matched = true
				break
			}
		}
		if matched {
			continue
		}
		return nil, fmt.Errorf("无法识别的字符 `%c` @ %d", c, i)
	}
	toks = append(toks, token{tkEOF, "", nil, i})
	return toks, nil
}

func isNameStart(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_'
}
func isNamePart(c byte) bool {
	return isNameStart(c) || (c >= '0' && c <= '9')
}

func collapseDoubleColon(raw string) string {
	// 处理 `A :: B` 形式：去除 ::
	var sb strings.Builder
	i := 0
	for i < len(raw) {
		if i+2 < len(raw) && raw[i] == ':' && raw[i+1] == ':' {
			sb.WriteString("::")
			i += 2
			continue
		}
		sb.WriteByte(raw[i])
		i++
	}
	out := sb.String()
	out = strings.ReplaceAll(out, "::", "\x00") // 用占位防二次折叠
	out = strings.Join(strings.Fields(out), "") // 去掉所有空白
	out = strings.ReplaceAll(out, "\x00", "::")
	return out
}

func stripQuotes(s string) string {
	return strings.ReplaceAll(s, "'", "")
}

// ─── 语法 ──────────────────────────────────────────────────────────────

type parser struct {
	toks []token
	idx  int
}

func (p *parser) peek() token { return p.toks[p.idx] }
func (p *parser) next() token { p.idx++; return p.toks[p.idx-1] }
func (p *parser) atKW(s string) bool {
	t := p.peek()
	return t.kind == tkKW && t.text == s
}
func (p *parser) atOp(s string) bool {
	t := p.peek()
	return t.kind == tkOp && t.text == s
}
func (p *parser) eatKW(s string) (token, error) {
	if !p.atKW(s) {
		return token{}, fmt.Errorf("期望 `%s`，遇到 `%s` @ %d", s, p.peek().text, p.peek().pos)
	}
	return p.next(), nil
}
func (p *parser) eatName() (string, token, error) {
	if p.peek().kind != tkName {
		return "", token{}, fmt.Errorf("期望名字，遇到 `%s` @ %d", p.peek().text, p.peek().pos)
	}
	t := p.next()
	return t.text, t, nil
}

func (p *parser) parse() (Expr, error) {
	e, err := p.conditional()
	if err != nil {
		return Expr{}, err
	}
	if p.peek().kind != tkEOF {
		return Expr{}, fmt.Errorf("表达式后存在多余内容 `%s` @ %d", p.peek().text, p.peek().pos)
	}
	return e, nil
}

func (p *parser) conditional() (Expr, error) {
	if p.atKW("if") {
		p.next()
		c, err := p.conditional()
		if err != nil {
			return Expr{}, err
		}
		if _, err := p.eatKW("then"); err != nil {
			return Expr{}, err
		}
		t, err := p.conditional()
		if err != nil {
			return Expr{}, err
		}
		if _, err := p.eatKW("else"); err != nil {
			return Expr{}, err
		}
		e, err := p.conditional()
		if err != nil {
			return Expr{}, err
		}
		return condExpr(c, t, e), nil
	}
	return p.coalesce()
}

func (p *parser) coalesce() (Expr, error) {
	left, err := p.binaryLevel("or")
	if err != nil {
		return Expr{}, err
	}
	for p.atOp("??") {
		p.next()
		r, err := p.binaryLevel("or")
		if err != nil {
			return Expr{}, err
		}
		left = coalExpr(left, r)
	}
	return left, nil
}

func (p *parser) binaryLevel(level string) (Expr, error) {
	nextLevel := func() (Expr, error) {
		switch level {
		case "or":
			return p.binaryLevel("xor")
		case "xor":
			return p.binaryLevel("implies")
		case "implies":
			return p.binaryLevel("and")
		case "and":
			return p.binaryLevel("equality")
		case "equality":
			return p.binaryLevel("relational")
		case "relational":
			return p.rangeLevel()
		}
		return Expr{}, fmt.Errorf("未知优先级层 %q", level)
	}
	left, err := nextLevel()
	if err != nil {
		return Expr{}, err
	}
	for {
		t := p.peek()
		var op string
		switch level {
		case "or":
			if t.kind == tkKW && t.text == "or" {
				op = "or"
			} else if t.kind == tkOp && t.text == "|" {
				op = "or"
			}
		case "xor":
			if t.kind == tkKW && t.text == "xor" {
				op = "xor"
			}
		case "implies":
			if t.kind == tkKW && t.text == "implies" {
				op = "implies"
			}
		case "and":
			if t.kind == tkKW && t.text == "and" {
				op = "and"
			} else if t.kind == tkOp && t.text == "&" {
				op = "and"
			}
		case "equality":
			if t.kind == tkOp && (t.text == "==" || t.text == "!=" || t.text == "===" || t.text == "!==") {
				op = t.text
			}
		case "relational":
			if t.kind == tkOp && (t.text == "<" || t.text == ">" || t.text == "<=" || t.text == ">=") {
				op = t.text
			}
		}
		if op == "" {
			return left, nil
		}
		p.next()
		r, err := nextLevel()
		if err != nil {
			return Expr{}, err
		}
		left = binExpr(op, left, r)
	}
}

// additiveLevel  →  multiplicativeLevel  →  power  →  unary
// (对齐 xtext KerMLExpressions 优先级链：+- < */% < **^ < 一元)
func (p *parser) additiveLevel() (Expr, error) {
	left, err := p.multiplicativeLevel()
	if err != nil {
		return Expr{}, err
	}
	for {
		t := p.peek()
		if t.kind != tkOp || (t.text != "+" && t.text != "-") {
			return left, nil
		}
		op := p.next().text
		r, err := p.multiplicativeLevel()
		if err != nil {
			return Expr{}, err
		}
		left = binExpr(op, left, r)
	}
}

func (p *parser) multiplicativeLevel() (Expr, error) {
	left, err := p.power()
	if err != nil {
		return Expr{}, err
	}
	for {
		t := p.peek()
		if t.kind != tkOp || (t.text != "*" && t.text != "/" && t.text != "%") {
			return left, nil
		}
		// 裸 `*`：只有后面确实跟操作数才算乘法；否则回溯
		if t.text == "*" {
			save := p.idx
			p.next()
			r, err := p.unary()
			if err != nil {
				p.idx = save
				return left, nil
			}
			left = binExpr("*", left, r)
			continue
		}
		op := p.next().text
		r, err := p.power()
		if err != nil {
			return Expr{}, err
		}
		left = binExpr(op, left, r)
	}
}

func (p *parser) rangeLevel() (Expr, error) {
	lo, err := p.additiveLevel()
	if err != nil {
		return Expr{}, err
	}
	if p.atOp("..") {
		p.next()
		hi, err := p.additiveLevel()
		if err != nil {
			return Expr{}, err
		}
		return rangeExpr(lo, hi), nil
	}
	return lo, nil
}

func (p *parser) power() (Expr, error) {
	base, err := p.unary()
	if err != nil {
		return Expr{}, err
	}
	if p.atOp("**") || p.atOp("^") {
		op := p.next().text
		// 右结合
		r, err := p.power()
		if err != nil {
			return Expr{}, err
		}
		return binExpr(op, base, r), nil
	}
	return base, nil
}

func (p *parser) unary() (Expr, error) {
	if p.atKW("not") {
		p.next()
		a, err := p.unary()
		if err != nil {
			return Expr{}, err
		}
		return notExpr(a), nil
	}
	if p.atOp("-") {
		p.next()
		a, err := p.unary()
		if err != nil {
			return Expr{}, err
		}
		if a.Kind == "literal" && a.Value != nil {
			if n, ok := (*a.Value).(float64); ok {
				neg := -n
				return litExpr(neg), nil
			}
		}
		zero := 0.0
		return binExpr("-", litExpr(zero), a), nil
	}
	return p.postfix()
}

func (p *parser) postfix() (Expr, error) {
	base, err := p.primary()
	if err != nil {
		return Expr{}, err
	}
	for {
		if p.atOp(".") {
			p.next()
			seg, _, err := p.eatName()
			if err != nil {
				return Expr{}, err
			}
			if base.Kind == "chain" && len(base.Path) > 0 {
				base.Path = append(base.Path, seg)
			} else {
				base = chainExpr(base, []string{seg})
			}
			continue
		}
		if p.atKW("as") || p.atKW("meta") {
			mode := p.next().text
			t, _, err := p.eatName()
			if err != nil {
				return Expr{}, err
			}
			base = castExpr(mode, base, t)
			continue
		}
		return base, nil
	}
}

func (p *parser) primary() (Expr, error) {
	t := p.peek()
	switch t.kind {
	case tkNum:
		p.next()
		return litExpr(t.val), nil
	case tkStr:
		p.next()
		return litExpr(t.val), nil
	case tkBool:
		p.next()
		return litExpr(t.val), nil
	case tkNull:
		p.next()
		return litExpr(nil), nil
	}
	if t.kind == tkOp && t.text == "(" {
		p.next()
		e, err := p.conditional()
		if err != nil {
			return Expr{}, err
		}
		if !p.atOp(")") {
			return Expr{}, fmt.Errorf("期望 `)`, 遇到 `%s` @ %d", p.peek().text, p.peek().pos)
		}
		p.next()
		return e, nil
	}
	if t.kind == tkOp && (t.text == "@" || t.text == "@@") {
		p.next()
		n, _, err := p.eatName()
		if err != nil {
			return Expr{}, err
		}
		return metaExpr(n, t.text == "@@"), nil
	}
	if t.kind == tkKW && (t.text == "istype" || t.text == "hastype") {
		kw := p.next().text
		all := false
		if p.atKW("all") {
			p.next()
			all = true
		}
		n, _, err := p.eatName()
		if err != nil {
			return Expr{}, err
		}
		if kw == "istype" {
			return istypeExpr(n, all), nil
		}
		return hastypeExpr(n, all), nil
	}
	if t.kind == tkKW && t.text == "all" {
		p.next()
		n, _, err := p.eatName()
		if err != nil {
			return Expr{}, err
		}
		return allExpr(n), nil
	}
	if t.kind == tkName {
		p.next()
		return refExpr(t.text), nil
	}
	return Expr{}, fmt.Errorf("期望表达式，遇到 `%s` @ %d", t.text, t.pos)
}

// ParseExpr 顶层入口
func ParseExpr(src string) (Expr, error) {
	toks, err := lex(src)
	if err != nil {
		return Expr{}, err
	}
	return (&parser{toks: toks}).parse()
}

// TryParseExpr — 失败返回 nil（validator 用）
func TryParseExpr(src string) Expr {
	e, err := ParseExpr(src)
	if err != nil {
		var z Expr
		return z
	}
	return e
}

// ─── 索引 ──────────────────────────────────────────────────────────────

type FeatureInfo struct {
	Name   string  `json:"name"`
	Kind   string  `json:"kind"`
	TypeRef *string `json:"typeRef,omitempty"`
	DefaultValue *string `json:"defaultValue,omitempty"`
}

type ElementInfo struct {
	Name         string        `json:"name"`
	QualifiedName string        `json:"qualifiedName"`
	Kind         string        `json:"kind"`
	TypeRef      *string       `json:"typeRef,omitempty"`
	Specializes  []string      `json:"specializes"`
	Metadata     []string      `json:"metadata"`
	Features     []FeatureInfo `json:"features"`
}

type Index struct {
	ByQualified map[string]*ElementInfo
	ByBare      map[string][]*ElementInfo
	All         []*ElementInfo
}

func NewIndex(elements []ElementInfo) *Index {
	idx := &Index{
		ByQualified: map[string]*ElementInfo{},
		ByBare:      map[string][]*ElementInfo{},
	}
	for i := range elements {
		el := elements[i]
		if el.QualifiedName == "" {
			el.QualifiedName = el.Name
		}
		if el.Specializes == nil {
			el.Specializes = []string{}
		}
		if el.Metadata == nil {
			el.Metadata = []string{}
		}
		if el.Features == nil {
			el.Features = []FeatureInfo{}
		}
		idx.ByQualified[el.QualifiedName] = &el
		idx.All = append(idx.All, &el)
		idx.ByBare[el.Name] = append(idx.ByBare[el.Name], &el)
	}
	return idx
}

func (i *Index) Resolve(name string) *ElementInfo {
	if e, ok := i.ByQualified[name]; ok {
		return e
	}
	// 末段
	last := name
	if idx := strings.LastIndex(name, "::"); idx >= 0 {
		last = name[idx+2:]
	}
	if list, ok := i.ByBare[last]; ok && len(list) == 1 {
		return list[0]
	}
	if list, ok := i.ByBare[last]; ok && len(list) > 0 {
		return list[0]
	}
	return nil
}

// 类型链：usage 的 [typeRef 解析出的 def, ...def 特化链] / def 的 [name, ...特化链]
func (i *Index) TypeChainOf(el *ElementInfo) []string {
	if el == nil {
		return nil
	}
	var chain []string
	visited := map[string]bool{}
	if el.TypeRef != nil {
		t := i.Resolve(*el.TypeRef)
		if t != nil {
			chain = append(chain, t.QualifiedName)
		} else {
			chain = append(chain, *el.TypeRef)
		}
		cur := t
		for cur != nil && len(cur.Specializes) > 0 {
			pname := cur.Specializes[0]
			if visited[pname] {
				break
			}
			visited[pname] = true
			p := i.Resolve(pname)
			if p != nil {
				chain = append(chain, p.QualifiedName)
			} else {
				chain = append(chain, pname)
			}
			cur = p
		}
	} else {
		chain = append(chain, el.QualifiedName)
		cur := el
		for cur != nil && len(cur.Specializes) > 0 {
			pname := cur.Specializes[0]
			if visited[pname] {
				break
			}
			visited[pname] = true
			p := i.Resolve(pname)
			if p != nil {
				chain = append(chain, p.QualifiedName)
			} else {
				chain = append(chain, pname)
			}
			cur = p
		}
	}
	return chain
}

// SubtypesOf: T 与其所有后代 qualifiedName 集合
func (i *Index) SubtypesOf(typeName string) map[string]bool {
	out := map[string]bool{}
	t := i.Resolve(typeName)
	if t != nil {
		out[t.QualifiedName] = true
	} else {
		out[typeName] = true
	}
	for changed := true; changed; {
		changed = false
		for _, el := range i.All {
			if out[el.QualifiedName] {
				continue
			}
			for _, s := range el.Specializes {
				r := i.Resolve(s)
				key := s
				if r != nil {
					key = r.QualifiedName
				}
				if out[key] {
					out[el.QualifiedName] = true
					changed = true
					break
				}
			}
		}
	}
	return out
}

func (i *Index) InstancesOf(typeName string) []*ElementInfo {
	types := i.SubtypesOf(typeName)
	var out []*ElementInfo
	for _, el := range i.All {
		if el.TypeRef == nil {
			continue
		}
		for _, t := range i.TypeChainOf(el) {
			if types[t] {
				out = append(out, el)
				break
			}
		}
	}
	return out
}

// ─── 求值 ──────────────────────────────────────────────────────────────

type EvalValue any // bool, float64, string, nil, *ElementInfo, []EvalValue, {range:[float64,float64]}

var metaclassOfKind = map[string]string{
	"partDef":       "PartDefinition",
	"partUsage":     "PartUsage",
	"portDef":       "PortDefinition",
	"portUsage":     "PortUsage",
	"attributeUsage": "AttributeUsage",
	"attributeDef":  "AttributeDefinition",
	"itemDef":       "ItemDefinition",
	"itemUsage":     "ItemUsage",
	"requirement":   "RequirementDefinition",
	"constraintBlock": "ConstraintDefinition",
	"stateMachine":  "StateMachineUsage",
	"stateDef":      "StateUsage",
	"activity":      "ActivityUsage",
	"actionDef":     "ActionUsage",
	"connection":    "ConnectionUsage",
	"enumDef":       "EnumerationDefinition",
	"view":          "ViewUsage",
	"viewpoint":     "ViewpointDefinition",
}

func toBool(v EvalValue) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0
	case string:
		return len(x) > 0
	case []EvalValue:
		return len(x) > 0
	}
	return true
}

func toNumber(v EvalValue) *float64 {
	switch x := v.(type) {
	case float64:
		return &x
	case bool:
		var f float64
		if x {
			f = 1
		} else {
			f = 0
		}
		return &f
	case string:
		if f, err := strconv.ParseFloat(x, 64); err == nil {
			return &f
		}
	}
	return nil
}

func nameEquals(a, b string) bool {
	if a == b {
		return true
	}
	la, lb := a, b
	if i := strings.LastIndex(a, "::"); i >= 0 {
		la = a[i+2:]
	}
	if i := strings.LastIndex(b, "::"); i >= 0 {
		lb = b[i+2:]
	}
	return la == lb
}

func classify(el *ElementInfo, x string) bool {
	if el == nil {
		return false
	}
	last := x
	if i := strings.LastIndex(x, "::"); i >= 0 {
		last = x[i+2:]
	}
	if meta, ok := metaclassOfKind[el.Kind]; ok && (meta == last || meta == x) {
		return true
	}
	for _, m := range el.Metadata {
		if nameEquals(m, x) {
			return true
		}
	}
	return false
}

func valueEqual(a, b EvalValue) bool {
	if a == nil || b == nil {
		return a == b
	}
	an := toNumber(a)
	bn := toNumber(b)
	if an != nil && bn != nil && !isString(a) && !isString(b) {
		return *an == *bn
	}
	if isString(a) || isString(b) {
		return toStr(a) == toStr(b)
	}
	ae := asEl(a)
	be := asEl(b)
	if ae != nil && be != nil {
		return ae.QualifiedName == be.QualifiedName
	}
	return a == b
}

func isString(v EvalValue) bool  { _, ok := v.(string); return ok }
func toStr(v EvalValue) string {
	if s, ok := v.(string); ok {
		return s
	}
	if e := asEl(v); e != nil {
		return e.QualifiedName
	}
	return fmt.Sprintf("%v", v)
}
func asEl(v EvalValue) *ElementInfo {
	if e, ok := v.(*ElementInfo); ok {
		return e
	}
	return nil
}
func typeof(v EvalValue) string {
	if v == nil {
		return "null"
	}
	return fmt.Sprintf("%T", v)
}

func Evaluate(expr Expr, self *ElementInfo, idx *Index) EvalValue {
	switch expr.Kind {
	case "literal":
		if expr.Value != nil {
			return *expr.Value
		}
		return nil
	case "ref":
		if e := idx.Resolve(*expr.Name); e != nil {
			return e
		}
		if self != nil && nameEquals(self.QualifiedName, *expr.Name) {
			return self
		}
		return nil
	case "meta":
		if expr.MetaMeta != nil && *expr.MetaMeta {
			if self == nil {
				return false
			}
			for _, t := range idx.TypeChainOf(self) {
				if e := idx.ByQualified[t]; e != nil && classify(e, *expr.Name) {
					return true
				}
			}
			return false
		}
		return classify(self, *expr.Name)
	case "istype":
		if self == nil {
			return false
		}
		chain := idx.TypeChainOf(self)
		if expr.All != nil && !*expr.All {
			if len(chain) == 0 {
				return false
			}
			return nameEquals(chain[0], *expr.Target)
		}
		for _, t := range chain {
			if nameEquals(t, *expr.Target) {
				return true
			}
		}
		return false
	case "hastype":
		if self == nil {
			return false
		}
		var wanted map[string]bool
		if expr.All != nil && *expr.All {
			wanted = idx.SubtypesOf(*expr.Target)
		}
		for _, f := range self.Features {
			if f.TypeRef == nil {
				continue
			}
			if expr.All == nil || !*expr.All {
				if nameEquals(*f.TypeRef, *expr.Target) {
					return true
				}
				continue
			}
			t := idx.Resolve(*f.TypeRef)
			key := *f.TypeRef
			if t != nil {
				key = t.QualifiedName
			}
			if wanted[key] {
				return true
			}
			synthetic := &ElementInfo{
				Name:         strings.SplitN(key, "::", 2)[len(strings.SplitN(key, "::", 2))-1],
				QualifiedName: key,
				Kind:         f.Kind,
				TypeRef:      f.TypeRef,
				Features:     []FeatureInfo{},
			}
			for _, c := range idx.TypeChainOf(synthetic) {
				if wanted[c] {
					return true
				}
			}
		}
		return false
	case "not":
		return !toBool(Evaluate(*expr.Arg, self, idx))
	case "binary":
		op := ""
		if expr.Op != nil {
			op = *expr.Op
		}
		if op == "and" {
			return toBool(Evaluate(*expr.Left, self, idx)) && toBool(Evaluate(*expr.Right, self, idx))
		}
		if op == "or" {
			return toBool(Evaluate(*expr.Left, self, idx)) || toBool(Evaluate(*expr.Right, self, idx))
		}
		if op == "implies" {
			return !toBool(Evaluate(*expr.Left, self, idx)) || toBool(Evaluate(*expr.Right, self, idx))
		}
		if op == "xor" {
			return toBool(Evaluate(*expr.Left, self, idx)) != toBool(Evaluate(*expr.Right, self, idx))
		}
		l := Evaluate(*expr.Left, self, idx)
		r := Evaluate(*expr.Right, self, idx)
		switch op {
		case "==", "===":
			return valueEqual(l, r)
		case "!=", "!==":
			return !valueEqual(l, r)
		case "+":
			if isString(l) || isString(r) {
				return toStr(l) + toStr(r)
			}
			an := toNumber(l)
			bn := toNumber(r)
			if an == nil || bn == nil {
				return nil
			}
			s := *an + *bn
			return s
		case "-", "*", "/", "%", "**", "^":
			an := toNumber(l)
			bn := toNumber(r)
			if an == nil || bn == nil {
				return nil
			}
			switch op {
			case "-":
				s := *an - *bn
				return s
			case "*":
				s := *an * *bn
				return s
			case "/":
				if *bn == 0 {
					return nil
				}
				s := *an / *bn
				return s
			case "%":
				if *bn == 0 {
					return nil
				}
				ai, bi := int64(*an), int64(*bn)
				s := float64(ai % bi)
				return s
			default:
				s := math_pow(*an, *bn)
				return s
			}
		case "<", ">", "<=", ">=":
			an := toNumber(l)
			bn := toNumber(r)
			if an == nil || bn == nil {
				return nil
			}
			switch op {
			case "<":
				return *an < *bn
			case ">":
				return *an > *bn
			case "<=":
				return *an <= *bn
			default:
				return *an >= *bn
			}
		}
		return nil
	case "range":
		lo := toNumber(Evaluate(*expr.Low, self, idx))
		hi := toNumber(Evaluate(*expr.High, self, idx))
		if lo == nil || hi == nil {
			return nil
		}
		return map[string]any{"range": []float64{*lo, *hi}}
	case "chain":
		cur := Evaluate(*expr.Base, self, idx)
		for _, seg := range expr.Path {
			e, ok := cur.(*ElementInfo)
			if !ok || e == nil {
				return nil
			}
			var f *FeatureInfo
			for i := range e.Features {
				if e.Features[i].Name == seg {
					f = &e.Features[i]
					break
				}
			}
			if f == nil {
				return nil
			}
			if f.TypeRef != nil {
				if t := idx.Resolve(*f.TypeRef); t != nil {
					cur = t
					continue
				}
			}
			if f.DefaultValue != nil {
				raw := strings.TrimSpace(*f.DefaultValue)
				if n, err := strconv.ParseFloat(raw, 64); err == nil {
					cur = n
				} else if raw == "true" {
					cur = true
				} else if raw == "false" {
					cur = false
				} else {
					cur = strings.Trim(raw, "\"")
				}
				continue
			}
			cur = &ElementInfo{
				Name:         f.Name,
				QualifiedName: e.QualifiedName + "::" + f.Name,
				Kind:         f.Kind,
				TypeRef:      f.TypeRef,
				Features:     []FeatureInfo{},
			}
		}
		return cur
	case "cond":
		if toBool(Evaluate(*expr.Cond, self, idx)) {
			return Evaluate(*expr.Then, self, idx)
		}
		return Evaluate(*expr.Els, self, idx)
	case "coalesce":
		l := Evaluate(*expr.Left, self, idx)
		if l == nil {
			return Evaluate(*expr.Right, self, idx)
		}
		return l
	case "all":
		list := idx.InstancesOf(*expr.Type)
		out := make([]EvalValue, len(list))
		for i, e := range list {
			out[i] = e
		}
		return out
	case "cast":
		return Evaluate(*expr.Arg, self, idx)
	}
	return nil
}

func math_pow(a, b float64) float64 {
	if b == 0 {
		return 1
	}
	return math.Pow(a, b)
}

// 避免未用警告
var _ = &parser{}