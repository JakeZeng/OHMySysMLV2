/**
 * UI Store — 全局 UI 状态（侧栏开关、模态框、主题、建模模式等）。
 *
 * M12 增量：`modelingMode` 从 View 实体移入此处。
 * 理由：建模呈现模式（可视化拖拽 / 文本编辑）是**全局 UI 偏好**，
 * 不是 SysML 语义属性，不应持久化在 ViewDefinition 上。
 */

import { create } from 'zustand';
import type { PaletteKind } from '../lib/insertSnippet';

export type ModelingMode = 'drag' | 'text';

/** M16 P2（Q2）：树组织模式 — 同为全局 UI 偏好，不是 SysML 语义 */
export type TreeOrgMode = 'package' | 'view';

/**
 * M19.x：建模工作区右侧「协作面板」的类型。
 *
 * - 'comments'：M9 模型评论
 * - 'presence'：M13 在线用户
 * - null：面板关闭
 *
 * 放在全局 UI store 而不是组件内 state 的原因：面板入口在工具栏
 * （ModelingToolbar），面板本体渲染在画布层（ModelingPane），两者是
 * 兄弟组件 —— state 必须提到共同的父级（这里是全局 store，最省事且
 * 与既有 `propertiesPaneOpen` 同一套路）。
 */
export type CollabPanelKind = 'comments' | 'presence';


interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  /** M12：建模模式 — 全局 UI 偏好（非 SysML 语义） */
  modelingMode: ModelingMode;
  /** M16 P2：树组织模式（按包层级 / 跨包视图视角） */
  treeOrgMode: TreeOrgMode;
  /** M12：右侧属性面板是否显影 */
  propertiesPaneOpen: boolean;
  /** M19.x：建模工作区的协作面板（评论 / 在线用户）当前展开哪个 */
  collabPanel: CollabPanelKind | null;
  /**
   * M17 S3：当前正从 palette 拖出的元素 kind；未拖拽为 null。
   * 用途：画布按矩阵实时算红/绿高亮与 dropEffect（dragover 期间
   * dataTransfer.getData 受保护读不到值，只能走 store）。
   */
  paletteDragKind: PaletteKind | null;

  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  setTheme: (t: 'light' | 'dark') => void;
  setModelingMode: (m: ModelingMode) => void;
  setTreeOrgMode: (m: TreeOrgMode) => void;
  togglePropertiesPane: () => void;
  setPropertiesPane: (open: boolean) => void;
  /** M19.x：打开协作面板（点同一个按钮 = 收起） */
  toggleCollabPanel: (panel: CollabPanelKind) => void;
  setCollabPanel: (panel: CollabPanelKind | null) => void;
  setPaletteDragKind: (kind: PaletteKind | null) => void;
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

const STORED_TREE_ORG_MODE = (() => {
  try {
    const m = localStorage.getItem('sysmlv2.treeOrgMode');
    if (m === 'package' || m === 'view') return m;
  } catch {
    /* ignore */
  }
  return 'package' as const;
})();

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: STORED_THEME,
  modelingMode: STORED_MODELING_MODE,
  treeOrgMode: STORED_TREE_ORG_MODE,
  propertiesPaneOpen: true,
  collabPanel: null,
  paletteDragKind: null,

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

  setTreeOrgMode(m) {
    try {
      localStorage.setItem('sysmlv2.treeOrgMode', m);
    } catch {
      /* ignore */
    }
    set({ treeOrgMode: m });
  },

  togglePropertiesPane() {
    set((s) => ({ propertiesPaneOpen: !s.propertiesPaneOpen }));
  },

  setPropertiesPane(open) {
    set({ propertiesPaneOpen: open });
  },

  toggleCollabPanel(panel) {
    set((s) => ({ collabPanel: s.collabPanel === panel ? null : panel }));
  },

  setCollabPanel(panel) {
    set({ collabPanel: panel });
  },

  setPaletteDragKind(kind) {
    set({ paletteDragKind: kind });
  },
}));
