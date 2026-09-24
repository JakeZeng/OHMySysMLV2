/**
 * M13 协同状态 store — 单一 scope 上下文。
 *
 * 设计要点：
 *   - 只跟踪当前激活 scope 的 presence + lock + remote content version
 *   - SSE 事件驱动更新；任何组件订阅 useCollabStore 即可
 *   - 冲突由 modelStore 在 saveContent 失败时显式设置（不经 SSE）
 *
 * 使用：
 *   const { presence, lock } = useCollabStore();
 *   useCollabStore.getState().setPresenceFromEvent(users);
 */

import { create } from 'zustand';
import type {
  ConflictDetails,
  LockResponse,
  MergeStrategy,
  UserPresence,
} from '../lib/collab/types';

interface CollabState {
  /** 当前激活 scope（'package:<id>' 等），null = 未激活 */
  activeScope: string | null;
  /** 在线用户列表（不含自己） */
  presence: UserPresence[];
  /** 当前 scope 的锁状态（owner=undefined 表示无锁） */
  lock: LockResponse | null;
  /** SSE 是否已连接 */
  connected: boolean;
  /** 最近一次 SSE error */
  lastError: string | null;
  /** 当前内容会话的"原始版本号"——保存时作为 baseVersion */
  baseVersion: number;
  /** 当前内容会话的"原始内容"——保存时作为 baseContent（供 409 retry） */
  baseContent: string;
  /** 409 冲突详情；非空时 ConflictModal 应弹出 */
  conflict: ConflictDetails | null;
  /** 手动合并模式下的工作副本 */
  mergedContent: string | null;
  /** 合并策略（用户选择） */
  mergeStrategy: MergeStrategy;
  /** 当前用户 ID（presence 排除自己用） */
  currentUserId: string | null;

  // ── Actions ────────────────────────────────────────────
  setActiveScope: (scope: string | null) => void;
  setConnected: (c: boolean) => void;
  setLastError: (e: string | null) => void;
  setPresence: (users: UserPresence[]) => void;
  setLock: (lock: LockResponse | null) => void;
  setBaseContent: (version: number, content: string) => void;
  setConflict: (c: ConflictDetails | null) => void;
  setMergedContent: (c: string | null) => void;
  setMergeStrategy: (s: MergeStrategy) => void;
  setCurrentUserId: (id: string | null) => void;

  /** 重置（切换 scope 时） */
  resetScope: () => void;
}

const empty: Pick<
  CollabState,
  'presence' | 'lock' | 'connected' | 'lastError' | 'conflict' | 'mergedContent' | 'mergeStrategy'
> = {
  presence: [],
  lock: null,
  connected: false,
  lastError: null,
  conflict: null,
  mergedContent: null,
  mergeStrategy: 'mine',
};

export const useCollabStore = create<CollabState>((set, get) => ({
  activeScope: null,
  ...empty,
  baseVersion: 1,
  baseContent: '',
  currentUserId: null,

  setActiveScope(scope) {
    if (get().activeScope === scope) return;
    set({ activeScope: scope, ...empty });
  },

  setConnected(c) {
    set({ connected: c });
  },

  setLastError(e) {
    set({ lastError: e });
  },

  setPresence(users) {
    set({ presence: users ?? [] });
  },

  setLock(lock) {
    set({ lock });
  },

  setBaseContent(version, content) {
    set({ baseVersion: version, baseContent: content });
  },

  setConflict(c) {
    set({
      conflict: c,
      // 默认 mine：保留用户当前 content，由 ConflictModal 切换
      mergeStrategy: c ? 'mine' : 'mine',
      mergedContent: c ? null : null,
    });
  },

  setMergedContent(c) {
    set({ mergedContent: c });
  },

  setMergeStrategy(s) {
    set({ mergeStrategy: s });
  },

  setCurrentUserId(id) {
    set({ currentUserId: id });
  },

  resetScope() {
    set({
      ...empty,
      baseVersion: get().baseVersion,
      baseContent: get().baseContent,
    });
  },
}));