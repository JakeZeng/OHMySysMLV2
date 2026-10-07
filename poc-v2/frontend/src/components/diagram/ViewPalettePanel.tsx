/**
 * M19：视图工具箱面板 —— 与**包调色板**（`diagram/PalettePanel`）并列的另一套工具箱。
 *
 * ## 为什么要单独一个面板
 *
 * 需求 2 要求视图建模与包建模**区分开**。二者回答的根本不是同一个问题：
 *   - 包调色板：「一个包里能放哪些 SysML 元素」（语法允许集）
 *   - 视图工具箱：「**这种视图**里能放哪些元素」（标准视图的内容契约，§9.2.20）
 * 改造前视图画布挂的是包调色板，于是 ActionFlowView 里能拖进 `part def`、
 * StateTransitionView 里能拖进 `requirement def` —— 官方文档里明文禁止的组合，
 * 而用户没有任何提示。
 *
 * ## 契约驱动，不是手工维护
 *
 * 组与条目全部来自 `lib/viewToolbox.ts` 的 `viewToolbox(standard)`，那份数据
 * 逐条对应官方 doc 的 "Valid nodes and edges"，并由 `tests/viewToolbox.test.ts`
 * 用真 parser 做差分（标 supported 的必须真能写出来）。改官方契约只需改那一份。
 *
 * ## 三态呈现（不给用户假希望）
 *
 *   · 可用     → 正常按钮，点击插入
 *   · 置灰     → 本项目语法尚未支持，tooltip 写明原因与后续（与包调色板同约定）
 *   · 不出现   → 不在该视图类型的官方内容契约里（连置灰都不给 —— 那不是「以后支持」
 *               能解决的，是「这种视图本来就不收」）
 */

import * as React from 'react';
import { AlertTriangle, Layers, Plus, Sparkles } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { useToast } from '../ui/Toast';
import { generateUniqueName } from '../../lib/naming';
import {
  toolboxForView,
  type ViewToolboxItem,
  type ViewToolboxKind,
} from '../../lib/viewToolbox';
import { STANDARD_VIEW_BY_NAME } from '../../lib/sysmlViewCatalog';
import { parse } from '@parser/parser';

export interface ViewPalettePanelProps {
  /** 可选：宿主已知的视图对象（避免面板自己再查一遍 store） */
  view?: { name?: string | null; standardView?: string | null; specializes?: string | null } | null;
}

export const ViewPalettePanel: React.FC<ViewPalettePanelProps> = ({ view: viewProp }) => {
  const nodes = useModelStore((s) => s.pipeline.nodes);
  const entityKind = useModelStore((s) => s.entityKind);
  const createNodeFromPalette = useModelStore((s) => s.createNodeFromPalette);
  const { showToast } = useToast();

  /**
   * 标准视图类型的判定顺序：
   *   1. 宿主传入的视图对象（树上的那条记录，带后端算出的 standardView）
   *   2. 当前编辑会话解析出来的 view（文本里写了 `:> StandardViewDefinitions::X`）
   *
   * 两者都拿不到时 `isCustom=true`，面板顶部会明说「自定义视图类型」，
   * 工具箱退化为通用集合 —— 不假装是标准视图。
   */
  const parsed = useModelStore((s) => s.pipeline.model.views?.[0]);
  const source = viewProp ?? parsed ?? null;
  const { standard, groups, isCustom } = React.useMemo(
    () => toolboxForView(source ?? {}),
    [source?.standardView, source?.specializes, source?.name],
  );

  const stdDef = standard ? STANDARD_VIEW_BY_NAME[standard] : null;

  /** 现有节点名（自动命名去重） */
  const existingNames = React.useMemo(
    () =>
      nodes
        .map((n) => String((n.data as { label?: string } | undefined)?.label ?? ''))
        .filter(Boolean),
    [nodes],
  );

  const insert = (item: ViewToolboxItem) => {
    if (!item.supported) {
      showToast({
        title: `${item.label} 尚不可用`,
        description: item.unsupportedReason,
        variant: 'error',
      });
      return;
    }
    const name = generateUniqueName(item.defaultName, existingNames);
    const name2 = generateUniqueName(
      item.defaultName2 ?? 'TargetPart',
      [...existingNames, name],
    );
    const snippet = item.generate(name, name2);

    // 与包调色板同一条写路径：insertSnippetScoped 目标 = 当前视图体。
    // M17 S1 的 parse 守卫在这里同样生效 —— 坏片段被拒绝，画布保持上一次结果。
    const r = createNodeFromPalette(snippet, name);
    if (!r.ok) {
      showToast({ title: '创建失败', description: r.reason, variant: 'error' });
      return;
    }
    showToast({
      title: `已添加 ${item.label}`,
      description: `${item.label} "${name}" 已插入视图`,
      variant: 'success',
    });
  };

  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  const disabledItems = groups
    .flatMap((g) => g.items)
    .filter((i) => !i.supported).length;

  return (
    <aside
      className="flex w-56 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
      data-testid="view-palette-panel"
    >
      {/* 头部：视图类型徽章 —— 这是「视图 ≠ 包」最直观的落点 */}
      <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" />
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            视图工具箱
          </h3>
        </div>
        {stdDef ? (
          <>
            <div
              className="mt-1.5 inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
              data-testid="view-standard-badge"
              title={`§9.2.20 StandardViewDefinitions::${stdDef.name}`}
            >
              «{stdDef.label}» {stdDef.shortName}
            </div>
            {stdDef.specializes && (
              <p className="mt-1 text-[10px] text-gray-400">
                特化自 {STANDARD_VIEW_BY_NAME[stdDef.specializes].label}
              </p>
            )}
          </>
        ) : (
          <div
            className="mt-1.5 rounded bg-amber-50 px-1.5 py-1 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            data-testid="view-standard-badge"
          >
            自定义视图类型（未特化任一标准视图）
          </div>
        )}
        <p className="mt-1 text-[10px] text-gray-400">
          仅收录官方内容契约里的 {totalItems} 类元素
          {disabledItems > 0 && `，其中 ${disabledItems} 类语法未实现`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groups.map((g) => (
          <div
            key={g.key}
            className="border-b border-gray-100 px-2 py-2 dark:border-gray-800"
            data-testid={`view-toolbox-group-${g.key}`}
          >
            <div
              className="px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
              title={`官方内容契约：${g.contract}`}
            >
              {g.label}
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
              {g.items.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  aria-disabled={!item.supported || undefined}
                  onClick={() => insert(item)}
                  className={[
                    'flex items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition',
                    item.supported
                      ? 'text-gray-700 hover:bg-white hover:shadow-sm dark:text-gray-200 dark:hover:bg-gray-800'
                      : 'cursor-not-allowed text-gray-300 opacity-50 dark:text-gray-600',
                  ].join(' ')}
                  title={
                    item.supported
                      ? `${item.description}\n契约：${item.contract}\n${item.specRef}`
                      : `${item.description}\n未支持：${item.unsupportedReason}\n契约：${item.contract}`
                  }
                  data-testid={`view-toolbox-item-${item.kind}`}
                >
                  <span className="text-sm leading-none">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.supported ? (
                    <Plus className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-500">
          <Sparkles className="mr-1 inline h-2.5 w-2.5" />
          连线由画布拖线生成（connect / flow / transition / bind）
        </div>
      </div>

      <div className="border-t border-gray-200 px-2 py-1.5 text-[10px] text-gray-400 dark:border-gray-700">
        💡 点击插入到**视图体**（不是包）
      </div>
    </aside>
  );
};

/**
 * 供测试与宿主复用的判定：从视图文本内容算出工具箱。
 *
 * 单独导出是为了让「文本 → 工具箱」这条链路能脱离 React 被测（面板只是壳）。
 */
export function toolboxForViewContent(content: string): ReturnType<typeof toolboxForView> {
  const r = parse(content);
  const v = r.ok ? r.model.views?.[0] : undefined;
  return toolboxForView(v ?? {});
}

export type { ViewToolboxKind };