/**
 * M15 ViewRenderer — 视图渲染路由（SysML v2 §7.26 `render <RenderingRef>;`）。
 *
 * 根据 view.renderKind（解析自 content 的 `render <RenderingRef>;` 子句，按引用名推导）分发：
 *   - interconnection（默认）→ 可编辑互连图（ViewModelingPane / DiagramCanvas）
 *   - tree                  → TreeRenderer（ownership 投影树）
 *   - requirement           → RequirementRenderer（需求表）
 *   - state / action / snapshot → BehaviorRenderer（行为/属性只读视图）
 *
 * 所有非 interconnection 都是「只读渲染」：顶部 ViewpointSummary 展示 satisfies /
 * render / filter / expose 解析状态，下方是结构化结果。interconnection
 * 保持既有的可编辑建模面板，避免破坏 M12 的编辑体验。
 *
 * M15 P0：把 `+子句` 按钮的回调桥接到 ViewModelingPane —— interconnection 视图
 * 才允许插入子句（其它视图 +子句 仍可点按 —— 内容也会被写回，让用户切换 render 后生效）。
 * M15 P2：state/action/snapshot 各自有只读 renderer，不再回退到 interconnection。
 *
 * ── M19：补一个「进入建模」出口 ──────────────────────────────────────
 * 只读呈现是 M12 的既有设计，但它带来一个 M19 才暴露的问题：**标准库给
 * GridView 推荐 `asElementTable`、给 BrowserView 推荐 `asTreeDiagram`**，
 * 这两种渲染都落进只读分支 → 这两个标准视图类型在 UI 上**根本拿不到工具箱**，
 * 需求③「不同视图类型对应不同工具箱」对它们就不成立。
 *
 * 修法不是把默认改成建模（那会破坏 M12 体验），而是给只读呈现加一个**显式出口**：
 * 顶部条右侧一个「进入建模 / 回到呈现」开关，默认仍是呈现。用户想改视图体时
 * 切过去，改完切回来 —— 两种姿态都在，缺的是入口不是能力。
 */

import * as React from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { DiagramCanvasHandle } from '../../canvas/DiagramCanvas';
import { ViewModelingPane } from '../modeling/ViewModelingPane';
import { ViewpointSummary } from './ViewpointSummary';
import { TreeRenderer } from './TreeRenderer';
import { RequirementRenderer } from './RequirementRenderer';
import { BehaviorRenderer, type BehaviorKind } from './BehaviorRenderer';
import { useViewDetail } from './useViewDetail';
import {
  makeClauseInserter,
  type FilterOperator,
  type RenderKind as ClauseRenderKind,
} from '../../lib/viewClauses';
import { useViewContent } from '../../hooks/useViewContent';

export interface ViewRendererProps {
  viewId: string;
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
  /** 选中的画布连线 → 右栏连线属性窗 */
  onSelectEdge: (e: Edge | null) => void;
  onDiagramReady?: (handle: DiagramCanvasHandle | null) => void;
  /** 点击 satisfies 视角时跳转（宿主注入） */
  onOpenViewpoint?: (viewpointId: string) => void;
  /** M17：双击画布节点 → 请宿主聚焦右栏「名称」输入框 */
  onRenameFocus?: () => void;
  /** 连线属性窗「在文本编辑器中查看」→ 定位行 */
  revealLineTick?: { line: number; tick: number };
}

const BEHAVIOR_KINDS: ReadonlySet<BehaviorKind> = new Set(['state', 'action', 'snapshot']);

/** M19：只读呈现 / 建模 两态 */
type Surface = 'present' | 'model';

/**
 * M19：姿态切换按钮。默认「呈现」（M12 既有行为），点一下进「建模」。
 *
 * 切换的**不是**渲染方式（render 由 `render` 子句决定），而是「这条视图现在
 * 是拿来展示、还是拿来编辑」—— 两者是正交的，别混。
 */
const SurfaceToggleButton: React.FC<{
  surface: Surface;
  onChange: (s: Surface) => void;
}> = ({ surface, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(surface === 'model' ? 'present' : 'model')}
    aria-pressed={surface === 'model'}
    data-testid={surface === 'model' ? 'view-surface-present' : 'view-surface-model'}
    title={
      surface === 'model'
        ? '回到只读呈现（当前：建模中，可编辑视图体与工具箱）'
        : '进入建模：可编辑视图体，并使用按本视图类型分化的工具箱'
    }
    className={[
      'rounded px-1.5 py-0.5 text-[10px] font-medium transition',
      surface === 'model'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300',
    ].join(' ')}
  >
    {surface === 'model' ? '回到呈现' : '进入建模'}
  </button>
);

export const ViewRenderer: React.FC<ViewRendererProps> = ({
  viewId,
  selectedNode,
  onSelectNode,
  onSelectEdge,
  onDiagramReady,
  onOpenViewpoint,
  onRenameFocus,
  revealLineTick,
}) => {
  const { view } = useViewDetail(viewId);
  const renderKind = view?.renderKind ?? 'interconnection';
  const viewContent = useViewContent(viewId);
  // 换视图时回到「呈现」：建模姿态不该从一个视图漏到另一个（工具箱会跟着换，
  // 但用户在毫不知情的情况下进入了可编辑状态）。
  const [surface, setSurface] = React.useState<Surface>('present');
  React.useEffect(() => {
    setSurface('present');
  }, [viewId]);

  /** M15：把子句插入 view content 的统一回调 */
  const handleInsertClause = React.useCallback(
    (
      kind: 'expose' | 'filter' | 'render' | 'satisfy',
      payload: {
        path?: string;
        qualifiedName?: string;
        operator?: FilterOperator;
        recursive?: boolean;
        renderKind?: ClauseRenderKind;
      },
    ) => {
      const insert = makeClauseInserter({
        content: viewContent.content,
        defaultViewName: view?.name ?? 'NewView',
        setContent: viewContent.setContent,
      });
      insert(kind, payload);
    },
    [viewContent.content, viewContent.setContent, view?.name],
  );

  // interconnection → 可编辑互连图（默认；唯一允许落点交互的渲染方式）
  if (renderKind === 'interconnection') {
    return (
      <>
        <ViewpointSummary
          view={view}
          onOpenViewpoint={onOpenViewpoint}
          onInsertClause={handleInsertClause}
        />
        <div className="flex-1 min-h-0 overflow-hidden">
          <ViewModelingPane
            viewId={viewId}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
            onSelectEdge={onSelectEdge}
            onDiagramReady={onDiagramReady}
            onRenameFocus={onRenameFocus}
            revealLineTick={revealLineTick}
          />
        </div>
      </>
    );
  }

  // ── M19：只读分支增加「进入建模」出口 ──────────────────────────────
  // 切到建模姿态时挂的是同一个 ViewModelingPane，因此**按视图类型分化的工具箱
  // 照样在**（ViewModelingPane → ViewPalettePanel）—— 这正是 GridView /
  // BrowserView 之前缺失的那条路。
  if (surface === 'model') {
    return (
      <>
        <ViewpointSummary
          view={view}
          onOpenViewpoint={onOpenViewpoint}
          onInsertClause={handleInsertClause}
          surfaceToggle={
            <SurfaceToggleButton surface={surface} onChange={setSurface} />
          }
        />
        <div className="flex-1 min-h-0 overflow-hidden">
          <ViewModelingPane
            viewId={viewId}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
            onSelectEdge={onSelectEdge}
            onDiagramReady={onDiagramReady}
            onRenameFocus={onRenameFocus}
            revealLineTick={revealLineTick}
          />
        </div>
      </>
    );
  }

  // tree / requirement / state / action / snapshot → 只读结构化渲染 + 顶部条
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewpointSummary
        view={view}
        onOpenViewpoint={onOpenViewpoint}
        onInsertClause={handleInsertClause}
        surfaceToggle={<SurfaceToggleButton surface={surface} onChange={setSurface} />}
      />
      <div className="flex-1 min-h-0 overflow-auto">
        {renderKind === 'tree' && <TreeRenderer view={view} />}
        {renderKind === 'requirement' && <RequirementRenderer view={view} />}
        {BEHAVIOR_KINDS.has(renderKind as BehaviorKind) && (
          <BehaviorRenderer
            view={view}
            behaviorKind={renderKind as BehaviorKind}
          />
        )}
      </div>
    </div>
  );
};
