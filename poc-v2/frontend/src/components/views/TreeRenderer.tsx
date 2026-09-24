/**
 * M15 TreeRenderer — `render as tree` 的视图渲染器。
 *
 * 把 view 的 expose 引用按 SysML v2 qualified name（`A::B::C`）建成一棵
 * ownership 树，直观展示「视图投影了哪些命名空间下的元素」：
 *   - resolved   绿色 ✓（def 真实存在于包 body）
 *   - unresolved 红色 ✗（路径/def 在工程包树中不存在，附 reason）
 *   - owned      灰色 local（view body 内 owned 的 view-private 元素）
 *
 * 注意：expose 是引用不是复制 —— 同一个元素在多个视图里出现，
 * 树这里展示的是「从本视图视角看到的投影」，不是元素本体。
 */

import * as React from 'react';
import {
  CheckCircle2,
  XCircle,
  Lock,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { View } from '../../types/view';

interface RefNode {
  name: string;
  kind?: string;
  resolved: boolean;
  owned?: boolean;
  reason?: string;
  children: RefNode[];
}

function insertPath(root: RefNode, segments: string[], kind: string, resolved: boolean, reason?: string): void {
  let cur = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLeaf = i === segments.length - 1;
    let child = cur.children.find((c) => c.name === seg);
    if (!child) {
      child = {
        name: seg,
        kind: isLeaf ? kind : undefined,
        resolved,
        reason: isLeaf ? reason : undefined,
        children: [],
      };
      cur.children.push(child);
    }
    cur = child;
  }
}

function buildRefTree(view: View | null): RefNode {
  const root: RefNode = { name: '', resolved: true, children: [] };

  // owned（view-private）元素单独一组
  const ownedRoot: RefNode = {
    name: 'owned (view-private)',
    resolved: true,
    owned: true,
    children: [],
  };
  for (const el of view?.innerElements ?? []) {
    ownedRoot.children.push({ name: el.name, kind: el.kind, resolved: true, owned: true, children: [] });
  }
  if (ownedRoot.children.length > 0) root.children.push(ownedRoot);

  for (const el of view?.exposedElements ?? []) {
    const segs = el.qualifiedName.split('::').filter(Boolean);
    if (segs.length === 0) continue;
    insertPath(root, segs, el.kind, true);
  }
  for (const el of view?.exposedElementsUnresolved ?? []) {
    const segs = el.qualifiedName.split('::').filter(Boolean);
    if (segs.length === 0) continue;
    insertPath(root, segs, el.kind, false, el.reason);
  }
  return root;
}

function RefRow({ node, depth }: { node: RefNode; depth: number }) {
  const [open, setOpen] = React.useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const Icon = node.owned ? Lock : node.resolved ? CheckCircle2 : XCircle;

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => hasChildren && setOpen((v) => !v)}
        style={{ paddingLeft: depth * 14 + 6 }}
        className={cn(
          'flex w-full items-center gap-1 rounded py-0.5 pr-2 text-left',
          node.owned
            ? 'text-gray-500 dark:text-gray-400'
            : node.resolved
              ? 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800/60'
              : 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20',
        )}
      >
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {hasChildren &&
            (open ? (
              <ChevronDown className="h-3 w-3 text-gray-400" />
            ) : (
              <ChevronRight className="h-3 w-3 text-gray-400" />
            ))}
        </span>
        <Icon className={cn('h-3 w-3 shrink-0', node.resolved ? 'text-green-500' : 'text-red-500')} />
        <span className="truncate font-medium">{node.name}</span>
        {node.kind && (
          <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {node.kind}
          </span>
        )}
        {node.reason && (
          <span className="ml-1 shrink-0 truncate text-[10px] text-red-400" title={node.reason}>
            — {node.reason}
          </span>
        )}
      </button>
      {hasChildren && open && (
        <div>
          {node.children.map((c) => (
            <RefRow key={c.name + c.kind} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export const TreeRenderer: React.FC<{ view: View | null }> = ({ view }) => {
  const tree = React.useMemo(() => buildRefTree(view), [view]);

  if (!view) {
    return (
      <div className="p-4 text-sm text-gray-400">加载视图…</div>
    );
  }

  const refs =
    (view.exposedElements?.length ?? 0) +
    (view.exposedElementsUnresolved?.length ?? 0) +
    (view.innerElements?.length ?? 0);

  if (refs === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-gray-400">
        <p data-testid="tree-renderer-empty">该视图没有 expose 任何元素，也没有 owned 元素。</p>
        <p className="text-xs">在视图文本中写 <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">expose Pkg::El;</code> 或 <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">part def X;</code></p>
      </div>
    );
  }

  return (
    <div data-testid="tree-renderer" className="flex-1 overflow-auto p-2">
      {tree.children.map((c) => (
        <RefRow key={c.name} node={c} depth={0} />
      ))}
    </div>
  );
};
