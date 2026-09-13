/**
 * Model Store — 当前编辑的模型 + 解析/验证结果。
 *
 * 复用 POC v2 的端到端 pipeline：text → parse → validate → modelToFlow。
 */

import { create } from 'zustand';
import { parse } from '@parser/parser';
import { validate } from '@validator/validator';
import { modelToFlow } from '@transform/modelToFlow';
import type {
  ParseError,
  SysMLModel,
} from '@ast/model';
import type { ValidationIssue } from '@validator/validator';
import type { Node, Edge } from '@xyflow/react';
import { modelApi, type ModelRecord } from '../services/modelApi';

interface PipelineResult {
  parseErrors: ParseError[];
  validationIssues: ValidationIssue[];
  model: SysMLModel;
  nodes: Node[];
  edges: Edge[];
}

interface ModelState {
  modelId: string | null;
  projectId: string | null;
  name: string;
  content: string;
  version: number;
  pipeline: PipelineResult;
  saving: boolean;
  saved: boolean;
  loading: boolean;
  error: string | null;

  setName: (n: string) => void;
  setContent: (c: string) => void;
  setProject: (id: string | null) => void;
  runPipeline: (text: string) => void;
  loadModel: (projectId: string, modelId: string) => Promise<void>;
  saveModel: () => Promise<void>;
  reset: () => void;
}

const EMPTY_PIPELINE: PipelineResult = {
  parseErrors: [],
  validationIssues: [],
  model: { packages: [], connections: [] },
  nodes: [],
  edges: [],
};

export const useModelStore = create<ModelState>((set, get) => ({
  modelId: null,
  projectId: null,
  name: 'untitled',
  content: '',
  version: 1,
  pipeline: EMPTY_PIPELINE,
  saving: false,
  saved: false,
  loading: false,
  error: null,

  setName(n) {
    set({ name: n, saved: false });
  },

  setContent(c) {
    set({ content: c, saved: false });
    get().runPipeline(c);
  },

  setProject(id) {
    set({ projectId: id });
  },

  runPipeline(text) {
    let parseErrors: ParseError[] = [];
    let validationIssues: ValidationIssue[] = [];
    let model: SysMLModel = { packages: [], connections: [] };
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

    set({ pipeline: { parseErrors, validationIssues, model, nodes, edges } });
  },

  async loadModel(projectId, modelId) {
    set({ loading: true, error: null, projectId, modelId });
    try {
      const rec: ModelRecord = await modelApi.get(projectId, modelId);
      set({
        name: rec.name,
        content: rec.content,
        version: rec.version,
        modelId: rec.id,
        projectId,
        loading: false,
      });
      get().runPipeline(rec.content);
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  async saveModel() {
    const { projectId, modelId, name, content, version } = get();
    if (!projectId) {
      set({ error: '缺少 projectId，无法保存' });
      return;
    }
    set({ saving: true, error: null, saved: false });
    try {
      let rec: ModelRecord;
      if (modelId) {
        rec = await modelApi.update(projectId, modelId, {
          name,
          content,
          version,
        });
      } else {
        rec = await modelApi.create(projectId, {
          name,
          content,
          version: 1,
        });
      }
      set({
        modelId: rec.id,
        version: rec.version,
        saving: false,
        saved: true,
      });
      setTimeout(() => {
        // 简单的 "已保存" 提示
        set((s) => (s.saved ? { saved: false } : s));
      }, 2000);
    } catch (e) {
      set({ saving: false, error: (e as Error).message });
      throw e;
    }
  },

  reset() {
    set({
      modelId: null,
      projectId: null,
      name: 'untitled',
      content: '',
      version: 1,
      pipeline: EMPTY_PIPELINE,
      saving: false,
      saved: false,
      loading: false,
      error: null,
    });
  },
}));
