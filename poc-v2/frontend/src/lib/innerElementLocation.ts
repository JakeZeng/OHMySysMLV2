/**
 * M15 innerElementLocation — 定位 view body 内 owned 元素（InnerElement）
 * 在 view.content 文本中的偏移，便于 PropertyPanel / Monaco 跳转。
 *
 * 后端 `parser/viewBody.go` 解析 view body 时已记录 line/column；前端拿到的
 * `InnerElement` 也有 line（见 types/view.ts）。
 * 但前端要真实偏移（offset）才能让光标定位 —— 在前端做一遍轻量扫描：
 *
 *   1. 在 view.content 里找到 `view ... {` 的开始；
 *   2. 从那行往下数到 InnerElement.line 处的关键字处，得到 offset。
 *
 * 注意：
 *   - 这是 best-effort，view body 没有时退化为 -1；
 *   - 不依赖后端 AST 字段（保留 POC 的"后端粗存 + 前端精算"边界）。
 */

import type { InnerElement } from '../types/view';

/** 找到 `view <name> {` 的起始偏移（指向 `v`）。找不到返回 -1。 */
export function findViewBodyStart(content: string): number {
  // 三种合法形式：
  //   view def X  {      ← ViewDefinition
  //   view X     {       ← ViewUsage（无 def）
  //   view X : D {       ← ViewUsage（实例化）
  // 共性：`view` 关键字 + 至少一个名字 token + 可选 `def` 前缀 / `: Ref` 后缀 + `{`
  const patterns: RegExp[] = [
    /\bview\s+def\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/,
    /\bview\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*\s*\{/,
    /\bview\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/,
  ];
  let firstIdx = -1;
  for (const re of patterns) {
    const m = re.exec(content);
    if (m && (firstIdx === -1 || m.index < firstIdx)) {
      firstIdx = m.index;
    }
  }
  return firstIdx;
}

/** 在 content 中定位 InnerElement 的源 offset（粗算：view body 起始 + 行偏移近似）。 */
export function locateInnerElementOffset(
  content: string,
  inner: InnerElement,
): number {
  const viewStart = findViewBodyStart(content);
  if (viewStart < 0) return -1;

  // 1. 优先基于行号做"行内正则"匹配
  if (inner.line != null && inner.line > 0) {
    const lines = content.split('\n');
    let cur = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const target = cur + line.length + 1; // +1 for \n
      if (i + 1 === inner.line) {
        // 在该行里找关键字 + 元素名的 token
        const re = new RegExp(
          `\\b(?:part|port|action|state|requirement|constraint|item|attribute|connection|interface|occurrence)\\s+(?:def\\s+)?${escapeRegExp(inner.name)}\\b`,
        );
        const m = re.exec(line);
        return m ? cur + m.index : cur;
      }
      cur = target;
    }
    return -1;
  }

  // 2. 后备策略：从 view body 起始往后扫，找 `def <name>` / `<keyword> <name>`
  const re = new RegExp(
    `\\b(?:part|port|action|state|requirement|constraint|item|attribute|connection|interface|occurrence)\\s+(?:def\\s+)?${escapeRegExp(inner.name)}\\b`,
    'g',
  );
  re.lastIndex = viewStart;
  const m = re.exec(content);
  return m ? m.index : -1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把 InnerElement 按 offset 排序（便于 PropertyPanel 在跳错时找到最近的兄弟）。
 */
export function sortByOffset(items: InnerElement[], content: string): InnerElement[] {
  const itemsWithOffset = items.map((it) => ({
    it,
    offset: locateInnerElementOffset(content, it),
  }));
  itemsWithOffset.sort((a, b) => {
    if (a.offset === -1 && b.offset === -1) return 0;
    if (a.offset === -1) return 1;
    if (b.offset === -1) return -1;
    return a.offset - b.offset;
  });
  return itemsWithOffset.map((x) => x.it);
}
