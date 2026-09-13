/**
 * UI Store — 全局 UI 状态（侧栏开关、模态框、主题等）。
 */

import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark';

  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  setTheme: (t: 'light' | 'dark') => void;
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

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: STORED_THEME,

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
}));
