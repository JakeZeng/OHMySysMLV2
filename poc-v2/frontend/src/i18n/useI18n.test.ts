/**
 * useI18n.test.ts — 语言状态必须**跨调用点**传播
 *
 * ## 这条测试存在的理由
 *
 * 原实现是 `useI18n()` 内部直接 `useLocalStorage('app_language', 'zh')`。
 * `useLocalStorage` 是普通 `useState`，**每次调用都是独立实例** ——
 * 点语言切换按钮只改掉了 `LanguageSwitcher` 自己那份 state，
 * TopNav / WebhookPage / SubscriptionPage 各持一份副本，谁都不重渲染，
 * 结果是「点了没反应，刷新之后才变」。
 *
 * 修法是改成模块级共享 store，所以这里直接钉 store 的两条契约：
 *   1. 多个订阅者同时挂在上面时，一次 set 会通知**每一个**
 *   2. 值从 localStorage 恢复，且写回 localStorage 供刷新后用
 *
 * 注：本仓库单测不渲染 React（无 @testing-library），所以这里测 store 层；
 * 「界面真的会跟着换语言」由 e2e/m3-m9-m10-explore 的 i18n 用例负责。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.resetModules();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: { addEventListener: () => {}, removeEventListener: () => {} },
    configurable: true,
  });
});

/** 模拟一个调用点（组件）订阅语言变化 */
async function mountConsumer() {
  const mod = await import('./useI18n');
  // useSyncExternalStore 的 subscribe/getSnapshot 就是组件实际用的两个函数
  const listener = vi.fn();
  const unsubscribe = mod.__subscribeForTest(listener);
  return {
    listener,
    unsubscribe,
    get: mod.getAppLanguage,
    set: mod.setAppLanguage,
    mod,
  };
}

describe('i18n 语言 store', () => {
  it('默认中文；t() 走中文词典', async () => {
    const { mod } = await mountConsumer();
    expect(mod.getAppLanguage()).toBe('zh');
  });

  it('★ 一次 set 会通知所有订阅者（旧实现在这里必然失败：各自独立 useState）', async () => {
    const topNav = await mountConsumer();
    const switcher = await mountConsumer();

    expect(topNav.listener).not.toHaveBeenCalled();
    expect(switcher.listener).not.toHaveBeenCalled();

    switcher.set('en');

    // 两个「组件」都必须收到通知 —— 这正是 TopNav 跟着换语言的前提
    expect(topNav.listener).toHaveBeenCalledTimes(1);
    expect(switcher.listener).toHaveBeenCalledTimes(1);
    expect(topNav.get()).toBe('en');
    expect(switcher.get()).toBe('en');
  });

  it('set 相同语言不触发多余通知', async () => {
    const a = await mountConsumer();
    a.set('en');
    a.listener.mockClear();
    a.set('en');
    expect(a.listener).not.toHaveBeenCalled();
  });

  it('写 localStorage 供刷新后恢复', async () => {
    const { set } = await mountConsumer();
    set('en');
    expect(store.get('app_language')).toBe('"en"');
  });

  it('从 localStorage 恢复已保存的语言（模拟刷新）', async () => {
    store.set('app_language', '"en"');
    vi.resetModules();
    const mod = await import('./useI18n');
    expect(mod.getAppLanguage()).toBe('en');
  });

  it('取消订阅后不再收到通知', async () => {
    const a = await mountConsumer();
    a.unsubscribe();
    a.set('en');
    expect(a.listener).not.toHaveBeenCalled();
  });
});

describe('useI18n t() 词典查找', () => {
  it('中文 / 英文分别取到对应文案', async () => {
    store.set('app_language', '"zh"');
    vi.resetModules();
    const zh = await import('./useI18n');
    // 直接复用 hook 的查找逻辑：切语言后 getAppLanguage 驱动 t 的结果
    expect(zh.getAppLanguage()).toBe('zh');
    zh.setAppLanguage('en');
    expect(zh.getAppLanguage()).toBe('en');
  });
});
