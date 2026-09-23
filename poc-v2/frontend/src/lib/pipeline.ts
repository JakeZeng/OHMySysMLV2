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

  // 应用用户位置覆盖（保留拖动结果）；跳过带 parentId 的子节点
  if (userPositions) {
    nodes = nodes.map((n) => {
      if ((n as { parentId?: string }).parentId) return n;
      const up = userPositions[String(n.id)];
      return up ? { ...n, position: up } : n;
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
