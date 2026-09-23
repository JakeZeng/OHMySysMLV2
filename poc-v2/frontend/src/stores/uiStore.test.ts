/**
 * uiStore.test.ts — M12 全局 UI 状态（含从 View 实体迁出的 modelingMode）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

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
  useUIStore.setState({
    sidebarOpen: true,
    theme: 'light',
    modelingMode: 'drag',
    propertiesPaneOpen: true,
  });
});

describe('uiStore', () => {
  it('toggleSidebar flips and setSidebar sets explicitly', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().setSidebar(true);
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('setTheme persists to localStorage', () => {
    useUIStore.getState().setTheme('dark');
    expect(useUIStore.getState().theme).toBe('dark');
    expect(localStorage.getItem('sysmlv2.theme')).toBe('dark');
  });

  it('setModelingMode updates state and persists (M12: moved off View entity)', () => {
    useUIStore.getState().setModelingMode('text');
    expect(useUIStore.getState().modelingMode).toBe('text');
    expect(localStorage.getItem('sysmlv2.modelingMode')).toBe('text');
  });

  it('modelingMode is global — no per-view keying', () => {
    useUIStore.getState().setModelingMode('text');
    // 只有一个全局键，不随视图变化
    expect(Object.keys(_store)).toEqual(['sysmlv2.modelingMode']);
  });

  it('togglePropertiesPane flips and setPropertiesPane sets explicitly', () => {
    useUIStore.getState().togglePropertiesPane();
    expect(useUIStore.getState().propertiesPaneOpen).toBe(false);
    useUIStore.getState().setPropertiesPane(true);
    expect(useUIStore.getState().propertiesPaneOpen).toBe(true);
  });
});
