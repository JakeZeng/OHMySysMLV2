/**
 * UI Store — 全局 UI 状态（侧栏开关、模态框、主题、建模模式等）。
 *
 * M12 增量：`modelingMode` 从 View 实体移入此处。
 * 理由：建模呈现模式（可视化拖拽 / 文本编辑）是**全局 UI 偏好**，
 * 不是 SysML 语义属性，不应持久化在 ViewDefinition 上。
 */

import { create } from 'zustand';

export type ModelingMode = 'drag' | 'text';

interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  /** M12：建模模式 — 全局 UI 偏好（非 SysML 语义） */
  modelingMode: ModelingMode;
  /** M12：右侧属性面板是否显影 */
  propertiesPaneOpen: boolean;

  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  setTheme: (t: 'light' | 'dark') => void;
  setModelingMode: (m: ModelingMode) => void;
  togglePropertiesPane: () => void;
  setPropertiesPane: (open: boolean) => void;
}

const STORED_THEME = (() => {
  try {
    const t = localStorage.getItem('sysmlv2.theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* ignore */
  }
  return 'light' as const;
})();

const STORED_MODELING_MODE = (() => {
  try {
    const m = localStorage.getItem('sysmlv2.modelingMode');
    if (m === 'drag' || m === 'text') return m;
  } catch {
    /* ignore */
  }
  return 'drag' as const;
})();

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: STORED_THEME,
  modelingMode: STORED_MODELING_MODE,
  propertiesPaneOpen: true,

  toggleSidebar() {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  },

  setSidebar(open) {
    set({ sidebarOpen: open });
  },

  setTheme(t) {
    try {
      localStorage.setItem('sysmlv2.theme', t);
    } catch {
      /* ignore */
    }
    set({ theme: t });
  },

  setModelingMode(m) {
    try {
      localStorage.setItem('sysmlv2.modelingMode', m);
    } catch {
      /* ignore */
    }
    set({ modelingMode: m });
  },

  togglePropertiesPane() {
    set((s) => ({ propertiesPaneOpen: !s.propertiesPaneOpen }));
  },

  setPropertiesPane(open) {
    set({ propertiesPaneOpen: open });
  },
}));
