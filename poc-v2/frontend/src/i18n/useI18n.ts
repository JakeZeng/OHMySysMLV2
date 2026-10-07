/**
 * 国际化 Hook
 *
 * ## 为什么不是 `useLocalStorage` 一行搞定
 *
 * M9 最初的写法是 `useLocalStorage('app_language', 'zh')` 直接返回
 * `[language, setLanguage]`。**那是坏的**：`useLocalStorage` 内部是一个普通的
 * `useState`，每调用一次就是一个独立实例。于是点语言切换按钮只会改掉
 * `LanguageSwitcher` 自己那一份 state —— TopNav、WebhookPage、SubscriptionPage
 * 各自持有各自的副本，谁都不会重渲染，**整个界面根本不换语言**；刷新之后才
 * 因为重新读了 localStorage 而「看起来好了」。
 *
 * 这里换成模块级共享 store：一份 language + 一组订阅者。
 * 任何调用点调 `setLanguage`，所有调用点同步重渲染；localStorage 只负责跨刷新持久化。
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { translations, type Language } from './translations';

const STORAGE_KEY = 'app_language';

function readStoredLanguage(): Language {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 'zh';
    const parsed = JSON.parse(raw) as string;
    return parsed === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

// ─── 模块级共享 store ────────────────────────────────────────────

let currentLanguage: Language = 'zh';
let initialized = false;
const listeners = new Set<() => void>();

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  currentLanguage = readStoredLanguage();
}

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 模块级 setter：写 localStorage + 通知所有订阅者 */
export function setAppLanguage(lang: Language): void {
  ensureInitialized();
  if (lang === currentLanguage) return;
  currentLanguage = lang;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lang));
  } catch {
    // localStorage 不可用时静默：语言切换仍然生效，只是不持久化
  }
  emit();
}

export function getAppLanguage(): Language {
  ensureInitialized();
  return currentLanguage;
}

/**
 * 仅供单测订阅 store：生产代码走 `useAppLanguage()`（useSyncExternalStore）。
 * 存在的原因见 `useI18n.test.ts` —— 本仓库单测不渲染 React，
 * 「点一下全界面换语言」这条保证只能靠订阅者计数 + e2e 一起钉住。
 */
export const __subscribeForTest = subscribe;

export function useAppLanguage(): [Language, (l: Language) => void] {
  ensureInitialized();
  const language = useSyncExternalStore(subscribe, getAppLanguage, getAppLanguage);

  // 别的标签页改了语言 → 跟着更新
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        currentLanguage = readStoredLanguage();
        emit();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLanguage = useCallback((l: Language) => setAppLanguage(l), []);
  return [language, setLanguage];
}

// ─── Hook ──────────────────────────────────────────────────────

export function useI18n() {
  const [language, setLanguage] = useAppLanguage();
  // 简单嵌套键路径解析器（a.b.c）
  const t = useCallback(
    (key: string): string => {
      const keys = key.split('.');
      let value: unknown = translations[language];
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = (value as Record<string, unknown>)[k];
        } else {
          // 回退到中文
          let fallback: unknown = translations.zh;
          for (const fk of keys) {
            if (fallback && typeof fallback === 'object' && fk in fallback) {
              fallback = (fallback as Record<string, unknown>)[fk];
            } else {
              return key; // 找不到返回 key
            }
          }
          return typeof fallback === 'string' ? fallback : key;
        }
      }
      return typeof value === 'string' ? value : key;
    },
    [language]
  );

  return {
    language,
    setLanguage,
    t,
    isZh: language === 'zh',
    isEn: language === 'en',
  };
}

export type { Language };
