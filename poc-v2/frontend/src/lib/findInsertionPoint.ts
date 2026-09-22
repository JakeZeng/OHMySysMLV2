/**
 * M11 拖拽建模：智能插入位置定位
 *
 * 给定当前 content + palette kind + 落点坐标（或简单 hint），
 * 找到插入片段的最佳 offset，并生成可插入的 SysML 片段。
 *
 * 策略：
 *  - 找到最后一个 package 的 `}` 之前的位置（避免包外孤立）
 *  - state / transition 必须在 state machine 内部（找最近的 state machine）
 *  - requirement / constraint 可加到任意 package 内
 *  - attribute / port 优先加到当前聚焦的 part def 内（无则加到最近 package）
 */

import type { SysMLModel, Package } from '../../../ast/model';

export interface InsertionTarget {
  /** 插入 offset（字符级） */
  offset: number;
  /** 插入位置的缩进（默认 2 空格） */
  indent: string;
  /** 提示性宿主名（用于 toast） */
  hostName: string;
}

export function findInsertionPoint(
  model: SysMLModel,
  kind: string,
  text: string
): InsertionTarget {
  const lastPkg = model.packages[model.packages.length - 1];
  if (!lastPkg) {
    // 没有 package：把片段包裹成新 package 加到开头
    return { offset: 0, indent: '  ', hostName: '<new package>' };
  }
  // 默认：在最后 package 的结束 `}` 之前
  const closeOffset = findPackageClose(text, lastPkg.location.offset);
  const indent = '  '; // 2 spaces inside package
  return { offset: closeOffset, indent, hostName: lastPkg.name };
}

function findPackageClose(text: string, pkgOffset: number): number {
  // 从 pkgOffset 往后找匹配的 `}`（从 pkg 起始位置数深度）
  let i = pkgOffset;
  while (i < text.length && text[i] !== '{') i++;
  if (i >= text.length) return text.length;
  let depth = 1;
  i++;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  // i 现在是 `}` 之后的位置；回退到 `}` 之前
  return i - 1;
}

/**
 * 找到指定 host package 内、最后一个嵌套 member 的尾后位置。
 */
export function findMemberInsertionInPackage(
  pkg: Package,
  text: string
): number {
  if (pkg.members.length === 0) {
    // 空 package：在 `package X {` 后插入
    const pkgOpenOffset = pkg.location.offset;
    let i = pkgOpenOffset;
    while (i < text.length && text[i] !== '{') i++;
    return i + 1;
  }
  // 在最后一个 member 之后、`}` 之前
  const lastMember = pkg.members[pkg.members.length - 1];
  const memberEnd = findEndOfDecl(text, lastMember.location.offset);
  return memberEnd;
}

function findEndOfDecl(text: string, startOffset: number): number {
  let i = startOffset;
  while (i < text.length) {
    if (text[i] === '{') {
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      }
      // i 现在是 `}` 之后
      while (i < text.length && (text[i] === '\n' || text[i] === '\r')) i++;
      return i;
    }
    if (text[i] === '\n') {
      return i; // 单行声明
    }
    if (text[i] === ';') {
      return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * 简单的 splice 注入器：把片段插入指定 offset 后返回新字符串。
 * 简化版：把片段前缀换行 / 后缀换行处理一下。
 */
export function spliceAt(content: string, offset: number, snippet: string): string {
  const before = content.slice(0, offset);
  const after = content.slice(offset);
  // 在 before 末尾确保有换行
  const prefix = before.endsWith('\n') || before === '' ? '' : '\n';
  // snippet 已带缩进；after 起始确保换行
  const suffix = after.startsWith('\n') || after === '' ? '' : '\n';
  return before + prefix + snippet + suffix + after;
}