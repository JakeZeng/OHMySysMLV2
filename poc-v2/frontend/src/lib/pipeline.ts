/**
 * M12 共享文本 → 图 pipeline。
 *
 * 从 modelStore 抽出，供 usePackageContent / useViewContent 复用：
 *   text → parse → validate → modelToFlow → 应用用户位置覆盖
 *
 * 注意：ELK 异步布局不在此处（由调用方决定是否触发），保持本函数纯同步。
 */

import { parse } from '@parser/parser';
import { validate } from '@validator/validator';
import { modelToFlow } from '@transform/modelToFlow';
import type { ParseError, SysMLModel } from '@ast/model';
import type { ValidationIssue, ValidationScope } from '@validator/validator';
import type { Node, Edge } from '@xyflow/react';
import type { NodePosition } from '../stores/layoutStore';
import { stableKeyOf } from '@transform/stableKey';
import type { ExposedExternal } from '@transform/modelToFlow';

export interface PipelineResult {
  parseErrors: ParseError[];
  validationIssues: ValidationIssue[];
  model: SysMLModel;
  /**
   * M19：真正用来画图的模型。
   *
   * 视图会话里它 = 视图模型 **+ 投影进来的源元素**（被 expose 的那些）。
   * `model` 是用户写的文本解析结果（校验针对它），`graphModel` 是画布用的。
   * 没投影时两者相同。
   */
  graphModel?: SysMLModel;
  nodes: Node[];
  edges: Edge[];
  layoutMs?: number;
  layoutEngine?: 'grid' | 'elk';
  /**
   * M17 S3：nodes/edges 为上一次成功解析的陈旧图（本次 parse 失败，
   * 画布保留上一次成功结果而非清空）。
   */
  stale?: boolean;
}

export const EMPTY_MODEL: SysMLModel = {
  packages: [],
  connections: [],
  stateMachines: [],
  activities: [],
  requirements: [],
  traceLinks: [],
  constraintBlocks: [],
  enums: [],
  comments: [],
  views: [],
  viewpoints: [],
};

export const EMPTY_PIPELINE: PipelineResult = {
  parseErrors: [],
  validationIssues: [],
  model: EMPTY_MODEL,
  nodes: [],
  edges: [],
};

/**
 * M19：校验用的「工程级作用域」。
 *
 * 校验器只看到**当前 scope 的一段文本**，而 SysML v2 的命名空间是工程级的
 * （`view V : BaseView` 的 BaseView、`expose Pkg::Car` 的 Pkg 都在别的
 * scope 里）。没有这段输入，跨 scope 引用会被误判成「工程内不存在」。
 */
export interface PipelineValidation {
  /** 工程级名字清单（view 名 / viewpoint 名） */
  scope?: ValidationScope;
  /**
   * expose 路径的**权威**解析。
   *
   * 传入的是解析好的模型（当前文本），返回解析结果 —— 解析的唯一实现是
   * `views/scope.ts`，校验器不再自己实现一遍。
   */
  resolveExpose?: (model: SysMLModel) => ValidationScope['exposeResolution'];
}

/**
 * 同步运行 pipeline。
 *
 * @param text           SysML v2 源文本
 * @param userPositions  节点位置覆盖（nodeId → {x,y}）；undefined 表示不覆盖
 * @param exposed        M17 S4：视图会话的跨包 expose 元素（渲染为只读幽灵节点）
 * @param modelTransform M19：模型变换钩子。视图会话用它把「源模型里被 expose
 *                         的元素」投影进视图模型 —— 投影后画布上画的是
 *                         **真的那个元素**（带端口、带子结构），而不是幽灵盒。
 */
export function runPipeline(
  text: string,
  userPositions?: Record<string, NodePosition>,
  exposed?: ExposedExternal[],
  modelTransform?: (model: SysMLModel) => SysMLModel,
  validation?: PipelineValidation,
): PipelineResult {
  const t0 = performance.now();
  let parseErrors: ParseError[] = [];
  let validationIssues: ValidationIssue[] = [];
  let model: SysMLModel = EMPTY_MODEL;
  let graphModel: SysMLModel = EMPTY_MODEL;
  let nodes: Node[] = [];
  let edges: Edge[] = [];

  try {
    const r = parse(text);
    parseErrors = r.errors;
    model = r.model;

    const v = validate(model, {
      ...validation?.scope,
      // expose 的权威解析结果（没给就退回校验器自己的兜底判定）
      exposeResolution:
        validation?.resolveExpose?.(model) ?? validation?.scope?.exposeResolution,
    });
    validationIssues = v.issues;

    if (parseErrors.length === 0) {
      // M19：投影后的模型才进 modelToFlow —— 校验仍然针对**用户写的**那份文本
      // （投影进来的元素属于别的包，不该在这里重复报重复名之类的错）。
      graphModel = modelTransform ? modelTransform(model) : model;
      const f = modelToFlow(graphModel, exposed);
      nodes = f.nodes;
      edges = f.edges;
    }
  } catch (e) {
    parseErrors = [
      {
        message: (e as Error).message || 'Pipeline failed',
        location: { line: 1, column: 1, offset: 0 },
        severity: 'error',
        code: 'PIPELINE_ERROR',
      },
    ];
  }

  // 应用用户位置覆盖（保留拖动结果）
  //
  // M17：按 **stableKey** 查表，不是按 node.id —— node.id 是解析器计数器，
  // 任何一次文本编辑都会让它整体平移，按它查等于每次编辑都把用户拖的位置丢掉。
  //
  // 端口（带 parentId）**不再跳过**：改造前这里 return n，把端口的用户坐标整个
  // 丢掉，是「端口位置存不住」的直接原因。锚点由 DiagramCanvas 从 owner 的实时
  // 盒子推导，这里存的 x/y 只是重绘前的初值。
  //
  // ⚠️ 端口的 x/y 与 `NodePosition.attach` 一样是**相对 owner 的偏移**
  // （端口是 React Flow v12 的真子节点，RF 自己会加一次 owner 的绝对位置）。
  // DiagramCanvas 写回时已换算成这个坐标系，这里不要再加原点。
  if (userPositions) {
    nodes = nodes.map((n) => {
      const up = userPositions[stableKeyOf(n.data, String(n.id))];
      if (!up) return n;
      // 只取坐标 —— NodePosition 带 attach，直接塞进 position 会多出字段
      const next: Node = { ...n, position: { x: up.x, y: up.y } };
      if (up.attach) {
        // 锚点随节点下发，DiagramCanvas 才能由锚点反推位置（不必自己去 store 查）。
        // 存进 data 而不是 position：position 的语义是「坐标」，多塞字段会让
        // React Flow 的 adoptUserNodes 按脏数据重建内部节点。
        next.data = { ...n.data, attach: up.attach };
      }
      return next;
    });
  }

  return {
    parseErrors,
    validationIssues,
    model,
    graphModel,
    nodes,
    edges,
    layoutMs: performance.now() - t0,
    layoutEngine: 'grid',
  };
}
