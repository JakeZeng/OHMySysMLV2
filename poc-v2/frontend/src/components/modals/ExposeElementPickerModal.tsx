/**
 * M19.3：把元素暴露到当前视图的**选择器**。
 *
 * ## 为什么必须有
 *
 * `expose` 是视图获得模型内容的**唯一**机制（§7.26.2：视图工件 = 导入 → 过滤 → 渲染）。
 * 在本组件之前，工具箱里的 expose 条目只能插一段**占位注释**
 * （`// expose <Pkg>::<Element>;  ← 请选择要暴露的元素`）—— 语法上是「注释」，
 * 语义上是「什么都没有」。用户拿到一个空视图，工具箱却说「expose 可用」。
 *
 * 这是项目一贯反对的那种「看起来能用、实际静默失效」的入口。
 *
 * ## 数据来源（刻意不靠 props 层层传递）
 *
 * 包列表走 `usePackages(projectId)`，元素列表走工程树的元素缓存
 * （`elementTreeCacheStore.byPackageId`）。理由：这条链要穿过
 * ProjectDetail → MiddlePane → ViewRenderer → ViewModelingPane → ModelingPane →
 * ViewPalettePanel 六层，只为了传两个列表；而且**谁打开视图谁才有这些数据**，
 * 由组件自己按需取更贴合语义。代价是打开选择器时要拉一次包列表（摘要，很轻）。
 */

import * as React from 'react';
import { X, Search, ScanEye } from 'lucide-react';
import { usePackages } from '../../hooks/usePackages';
import { useElementTreeCacheStore } from '../../stores/elementTreeCacheStore';
import { useModelStore } from '../../stores/modelStore';
import type { ElementNodeInfo } from '../../lib/tree';

export interface ExposeCandidate {
  /** 完整限定路径，写进 `expose <path>;` */
  path: string;
  /** 展示名（元素名） */
  name: string;
  /** AST kind（partDef / stateDef / …） */
  kind: string;
  /** 归属包名（顶层为「<模型根>」） */
  packageLabel: string;
  /** 是否是包（包可用 `::*` 暴露其成员） */
  isPackage: boolean;
}

/**
 * 把包树 + 元素缓存拍平成候选列表。
 *
 * 纯函数、无 IO —— 这样「哪些是合法候选」可以脱离组件被单测钉住，
 * 而不必起一个 React 环境。
 */
export function buildExposeCandidates(
  packages: Array<{ id: string; name: string; parentPackageId?: string | null }>,
  byPackageId: Record<string, ElementNodeInfo[] | undefined>,
): ExposeCandidate[] {
  // 包 id → 限定名前缀
  const prefixOf = new Map<string, string>();
  const labelOf = new Map<string, string>();
  for (const p of packages) {
    const parent = p.parentPackageId ?? '';
    const parentPrefix = parent ? (prefixOf.get(parent) ?? '') : '';
    prefixOf.set(p.id, parentPrefix ? `${parentPrefix}::${p.name}` : p.name);
    labelOf.set(p.id, p.name);
  }

  const out: ExposeCandidate[] = [];

  const walk = (node: ElementNodeInfo, prefix: string, packageLabel: string) => {
    // 嵌套元素的限定路径是 `Pkg::Outer::Inner`（§7.26.3：expose 用限定名）
    const path = prefix ? `${prefix}::${node.name}` : node.name;
    const isPackage = node.kind === 'package';
    out.push({ path, name: node.name, kind: node.kind, packageLabel, isPackage });
    for (const c of node.children ?? []) walk(c, path, packageLabel);
  };

  for (const p of packages) {
    const prefix = prefixOf.get(p.id) ?? p.name;
    // 包本身可作为 expose 目标（官方四种粒度里 `P::*` / `P::*::**` 都以包为起点）
    out.push({ path: prefix, name: p.name, kind: 'package', packageLabel: p.name, isPackage: true });
    for (const el of byPackageId[p.id] ?? []) {
      if (el.ownerKind && el.ownerKind !== 'package') continue; // view-private 不可被 expose
      walk(el, prefix, labelOf.get(p.id) ?? p.name);
    }
  }
  return out;
}

/** 官方四种 expose 粒度（§7.26.2 / §8.2.2.26） */
export type ExposeForm = 'member' | 'memberRecursive' | 'namespace' | 'namespaceRecursive';

export function buildExposeClauseFor(path: string, form: ExposeForm): string {
  if (form === 'member') return `expose ${path};`;
  if (form === 'memberRecursive') return `expose ${path}::**;`;
  if (form === 'namespace') return `expose ${path}::*;`;
  return `expose ${path}::*::**;`;
}

export interface ExposeElementPickerModalProps {
  onPick: (clause: string, picked: ExposeCandidate, form: ExposeForm) => void;
  onClose: () => void;
}

const FORM_LABEL: Record<ExposeForm, string> = {
  member: '仅该元素',
  memberRecursive: '该元素及其后代（`::**`）',
  namespace: '命名空间直接成员（`::*`）',
  namespaceRecursive: '命名空间递归成员（`::*::**`）',
};

export const ExposeElementPickerModal: React.FC<ExposeElementPickerModalProps> = ({
  onPick,
  onClose,
}) => {
  const projectId = useModelStore((s) => s.projectId);
  const byPackageId = useElementTreeCacheStore((s) => s.byPackageId);
  const { packages, loading, error } = usePackages(projectId);

  const [query, setQuery] = React.useState('');
  const [form, setForm] = React.useState<ExposeForm>('member');

  const candidates = React.useMemo(
    () => buildExposeCandidates(packages, byPackageId),
    [packages, byPackageId],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) => c.path.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [candidates, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="expose-picker-backdrop"
    >
      <div
        className="flex max-h-[80vh] w-[620px] flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
        data-testid="expose-element-modal"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-100">
            <ScanEye className="h-4 w-4 text-brand-600" />
            暴露元素到本视图（expose）
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            data-testid="expose-element-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
          <Search className="h-3.5 w-3.5 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按名称或限定路径过滤…"
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800"
            data-testid="expose-element-search"
          />
          <select
            value={form}
            onChange={(e) => setForm(e.target.value as ExposeForm)}
            className="rounded border border-gray-300 px-1.5 py-1 text-[11px] dark:border-gray-600 dark:bg-gray-800"
            data-testid="expose-element-form"
            title="官方四种 expose 粒度（§7.26.2）"
          >
            {(Object.keys(FORM_LABEL) as ExposeForm[]).map((f) => (
              <option key={f} value={f}>
                {FORM_LABEL[f]}
              </option>
            ))}
          </select>
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto p-2">
          {loading && <p className="p-3 text-xs text-gray-400">正在加载包列表…</p>}
          {error && <p className="p-3 text-xs text-red-600">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="p-3 text-xs text-gray-400">
              没有可暴露的元素。工具箱里按包 / 定义创建元素，或换个过滤词。
            </p>
          )}
          {filtered.map((c) => (
            <button
              key={`${c.kind}:${c.path}`}
              type="button"
              onClick={() => onPick(buildExposeClauseFor(c.path, form), c, form)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              data-testid={`expose-element-option-${c.path}`}
              title={buildExposeClauseFor(c.path, form)}
            >
              <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                {c.kind}
              </span>
              <span className="flex-1 font-mono">{c.path}</span>
              <span className="text-[10px] text-gray-400">{c.packageLabel}</span>
            </button>
          ))}
        </div>

        <div className="border-t border-gray-200 px-4 py-2 text-[10px] text-gray-400 dark:border-gray-700">
          expose 是**引用不是拷贝**：元素归属不变，只是被拉进本视图的呈现范围（§7.26.2）
        </div>
      </div>
    </div>
  );
};
