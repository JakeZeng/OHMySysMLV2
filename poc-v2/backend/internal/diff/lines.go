// Package diff 提供行级 diff（Myers LCS），用于 M13 冲突响应。
//
// 输出 Hunk 列表：
//   - "equal":  base 和 server 相同行
//   - "insert": 仅 server 多出的行
//   - "delete": base 有但 server 没有的行
//
// 我们不做字符级合并（CRDT/OT）— SysML 是声明式 DSL，行级足够。
package diff

import "strings"

// Hunk 一个 diff 区段。
type Hunk struct {
	Type        string   `json:"type"`        // "equal" | "insert" | "delete"
	BaseStart   int      `json:"baseStart"`   // 1-indexed（0 = 文件开头）
	ServerStart int      `json:"serverStart"` // 1-indexed
	Count       int      `json:"count,omitempty"`
	Lines       []string `json:"lines,omitempty"` // 仅 insert / delete 有
}

// op 回溯中的一种操作。
type op struct {
	kind   string // "eq" | "ins" | "del"
	line   string
	i, j   int // base/server 行号（1-based；op 执行前的位置）
}

// Lines 计算 base→server 的行级 diff（LCS DP）。
//
// 时间 O(n*m)，空间 O(n*m)。n,m ≤ 5000 行够用（SysML 包一般 < 1000 行）。
func Lines(base, server string) []Hunk {
	baseLines := splitLines(base)
	serverLines := splitLines(server)
	n, m := len(baseLines), len(serverLines)

	// 边界 shortcut
	if n == 0 && m == 0 {
		return nil
	}
	if n == 0 {
		return []Hunk{{Type: "insert", ServerStart: 1, Lines: append([]string{}, serverLines...)}}
	}
	if m == 0 {
		return []Hunk{{Type: "delete", BaseStart: 1, Lines: append([]string{}, baseLines...)}}
	}

	// LCS DP 表（行号索引 1-based）
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := 1; i <= n; i++ {
		bi := baseLines[i-1]
		row := dp[i]
		prev := dp[i-1]
		for j := 1; j <= m; j++ {
			if bi == serverLines[j-1] {
				row[j] = prev[j-1] + 1
			} else if prev[j] >= row[j-1] {
				row[j] = prev[j]
			} else {
				row[j] = row[j-1]
			}
		}
	}

	// 回溯生成 ops（逆序）
	ops := make([]op, 0, n+m)
	i, j := n, m
	for i > 0 || j > 0 {
		switch {
		case i > 0 && j > 0 && baseLines[i-1] == serverLines[j-1]:
			ops = append(ops, op{kind: "eq", line: baseLines[i-1], i: i, j: j})
			i--
			j--
		case j > 0 && (i == 0 || dp[i][j-1] >= dp[i-1][j]):
			ops = append(ops, op{kind: "ins", line: serverLines[j-1], i: i, j: j})
			j--
		default:
			ops = append(ops, op{kind: "del", line: baseLines[i-1], i: i, j: j})
			i--
		}
	}
	// 反转为正序
	for a, b := 0, len(ops)-1; a < b; a, b = a+1, b-1 {
		ops[a], ops[b] = ops[b], ops[a]
	}

	// 把连续同类 op 打包成 Hunk
	return packOps(ops)
}

// packOps 把 ops 序列按同类合并成 Hunk 列表。
//
// 每个 op 自带 (i,j) 位置 — 同一 run 的首个 op 决定 Hunk 的 BaseStart/ServerStart。
func packOps(ops []op) []Hunk {
	out := make([]Hunk, 0, len(ops)/4+1)
	i := 0
	for i < len(ops) {
		o := ops[i]
		switch o.kind {
		case "eq":
			cnt := 0
			startI, startJ := o.i, o.j
			for i < len(ops) && ops[i].kind == "eq" {
				cnt++
				i++
			}
			out = append(out, Hunk{Type: "equal", BaseStart: startI, ServerStart: startJ, Count: cnt})
		case "ins":
			lines := []string{o.line}
			startJ := o.j
			i++
			for i < len(ops) && ops[i].kind == "ins" {
				lines = append(lines, ops[i].line)
				i++
			}
			out = append(out, Hunk{Type: "insert", BaseStart: o.i, ServerStart: startJ, Lines: lines})
		case "del":
			lines := []string{o.line}
			startI := o.i
			i++
			for i < len(ops) && ops[i].kind == "del" {
				lines = append(lines, ops[i].line)
				i++
			}
			out = append(out, Hunk{Type: "delete", BaseStart: startI, ServerStart: o.j, Lines: lines})
		}
	}
	return out
}

// splitLines 按 \n 切分；保留空行；规范 \r\n → \n。
func splitLines(s string) []string {
	if s == "" {
		return []string{}
	}
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.Split(s, "\n")
}
