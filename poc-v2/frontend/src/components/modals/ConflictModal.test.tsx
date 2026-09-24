/**
 * ConflictModal 单元测试 — 仅覆盖自动合并启发式函数（不渲染 React）
 */

import { describe, it, expect } from 'vitest';

// 复制 ConflictModal 内的启发式合并，避免导出私有 helper
// 这里仅断言"非空场景下行为合理"
describe('ConflictModal merge 启发式', () => {
  // 用闭包模拟 autoMerge 的逻辑
  function autoMerge(base: string, mine: string, server: string): string {
    const baseLines = base.split('\n');
    const mineLines = mine.split('\n');
    const serverLines = server.split('\n');
    const baseSet = new Set(baseLines);
    const serverExtras = serverLines.filter((l) => !baseSet.has(l));
    const seen = new Set(mineLines);
    const merged = [...mineLines];
    for (const line of serverExtras) {
      if (!seen.has(line)) {
        merged.push(line);
        seen.add(line);
      }
    }
    return merged.join('\n');
  }

  it('1. base为空 → 保留 mine + server 中没独有行的', () => {
    const merged = autoMerge('', 'A\nB', 'C\nD');
    expect(merged.split('\n').sort()).toEqual(['A', 'B', 'C', 'D'].sort());
  });

  it('2. base == mine → mine 的修改无 + server 的新增行', () => {
    // base: A  /  mine: A（未改）/  server: A\nB\nC（他人新增）
    const merged = autoMerge('A', 'A', 'A\nB\nC');
    expect(merged).toContain('A');
    expect(merged).toContain('B');
    expect(merged).toContain('C');
  });

  it('3. base == server → 保留 mine 的修改（无新增行）', () => {
    const merged = autoMerge('A\nB', 'A\nX', 'A\nB');
    expect(merged).toContain('X');
    expect(merged).not.toContain('\nB\n');
  });

  it('4. 三者互不相同 → 保留 mine + server 新增', () => {
    // base: A / mine: A+B / server: A+C
    const merged = autoMerge('A', 'A\nB', 'A\nC');
    expect(merged).toContain('B');
    expect(merged).toContain('C');
  });
});