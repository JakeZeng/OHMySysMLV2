/**
 * viewStore.test.ts — 视图一等公民核心 CRUD 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useViewStore } from './viewStore';

// localStorage mock（vitest 默认 node 环境）
const _store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
  key: (i: number) => Object.keys(_store)[i] ?? null,
  get length() { return Object.keys(_store).length; },
};
(globalThis as any).localStorage = localStorageMock;

beforeEach(() => {
  localStorage.clear();
  useViewStore.getState().reset();
});

describe('viewStore', () => {
  it('ensureViews creates 4 default views for a new model', () => {
    useViewStore.getState().ensureViews('model-1', 'tester');
    const { views, currentViewId } = useViewStore.getState();
    expect(views).toHaveLength(4);
    expect(views.map((v) => v.viewType)).toEqual(['structure', 'behavior', 'requirement', 'constraint']);
    expect(currentViewId).toBeTruthy();
    expect(views.find((v) => v.viewType === 'structure')?.id).toBe(currentViewId);
  });

  it('ensureViews idempotent — same model returns same data', () => {
    useViewStore.getState().ensureViews('model-1');
    const firstIds = useViewStore.getState().views.map((v) => v.id);
    useViewStore.getState().ensureViews('model-1');
    const secondIds = useViewStore.getState().views.map((v) => v.id);
    expect(secondIds).toEqual(firstIds);
  });

  it('createView adds new view of given type and selects it', () => {
    useViewStore.getState().ensureViews('m');
    const id = useViewStore.getState().createView({ viewType: 'structure', name: '次结构视图' });
    const state = useViewStore.getState();
    expect(state.views).toHaveLength(5);
    expect(state.currentViewId).toBe(id);
    expect(state.views.find((v) => v.id === id)?.name).toBe('次结构视图');
  });

  it('deleteView keeps at least one of each viewType', () => {
    useViewStore.getState().ensureViews('m');
    const structure = useViewStore.getState().views.find((v) => v.viewType === 'structure')!;
    const result = useViewStore.getState().deleteView(structure.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('structure');

    // 但可以删除新增的副本
    const newId = useViewStore.getState().createView({ viewType: 'structure', name: '副本' });
    const r2 = useViewStore.getState().deleteView(newId);
    expect(r2.ok).toBe(true);
  });

  it('setModelingMode updates single view', () => {
    useViewStore.getState().ensureViews('m');
    const viewId = useViewStore.getState().views[0].id;
    useViewStore.getState().setModelingMode(viewId, 'text');
    expect(useViewStore.getState().views.find((v) => v.id === viewId)?.modelingMode).toBe('text');
  });

  it('setViewType refuses to change when last of type', () => {
    useViewStore.getState().ensureViews('m');
    const structure = useViewStore.getState().views.find((v) => v.viewType === 'structure')!;
    useViewStore.getState().setViewType(structure.id, 'behavior');
    // 唯一结构视图不能转类型
    expect(useViewStore.getState().views.find((v) => v.id === structure.id)?.viewType).toBe('structure');
  });

  it('duplicateView creates a copy with "副本" suffix', () => {
    useViewStore.getState().ensureViews('m');
    const src = useViewStore.getState().views[0];
    useViewStore.getState().renameView(src.id, '主结构');
    const dupId = useViewStore.getState().duplicateView(src.id);
    expect(dupId).toBeTruthy();
    const dup = useViewStore.getState().views.find((v) => v.id === dupId);
    expect(dup?.name).toBe('主结构 副本');
  });

  it('persists to localStorage', () => {
    useViewStore.getState().ensureViews('m-persist');
    useViewStore.getState().reset();
    useViewStore.getState().ensureViews('m-persist');
    const views = useViewStore.getState().views;
    expect(views).toHaveLength(4);
  });
});