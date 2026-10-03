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
import type { ValidationIssue } from '@validator/validator';
import type { Node, Edge } from '@xyflow/react';
import type { NodePosition } from '../stores/layoutStore';
import { stableKeyOf } from '@transform/stableKey';

export interface PipelineResult {
  parseErrors: ParseError[];
  validationIssues: ValidationIssue[];
  model: SysMLModel;
  nodes: Node[];
  edges: Edge[];
  layoutMs?: number;
  layoutEngine?: 'grid' | 'elk';
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
 * 同步运行 pipeline。
 *
 * @param text           SysML v2 源文本
 * @param userPositions  节点位置覆盖（nodeId → {x,y}）；undefined 表示不覆盖
 */
export function runPipeline(
  text: string,
  userPositions?: Record<string, NodePosition>,
): PipelineResult {
  const t0 = performance.now();
  let parseErrors: ParseError[] = [];
  let validationIssues: ValidationIssue[] = [];
  let model: SysMLModel = EMPTY_MODEL;
  let nodes: Node[] = [];
  let edges: Edge[] = [];

  try {
    const r = parse(text);
    parseErrors = r.errors;
    model = r.model;

    const v = validate(model);
    validationIssues = v.issues;

    if (parseErrors.length === 0) {
      const f = modelToFlow(model);
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
    nodes,
    edges,
    layoutMs: performance.now() - t0,
    layoutEngine: 'grid',
  };
}
