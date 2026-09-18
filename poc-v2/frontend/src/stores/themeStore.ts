/**
 * Theme Store（M4.5 增量）。
 *
 * 管理深色/浅色模式切换，持久化到 localStorage。
 */

import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
}

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // ignore
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export const useThemeStore = create<ThemeState>((set) => {
  const initial = getInitialTheme();
  // 应用初始主题
  if (typeof document !== 'undefined') {
    applyTheme(initial);
  }

  return {
    theme: initial,
    toggle: () => {
      set((state) => {
        const next = state.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', next);
        applyTheme(next);
        return { theme: next };
      });
    },
    set: (theme: Theme) => {
      localStorage.setItem('theme', theme);
      applyTheme(theme);
      set({ theme });
    },
  };
});
