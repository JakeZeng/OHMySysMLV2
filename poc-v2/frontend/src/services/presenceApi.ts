/**
 * M13 在线状态（presence）API — scope 通用化封装。
 *
 * 后端真实路由（backend/cmd/server/main.go:426-432，均挂在 /api/v1 下）：
 *   POST   /api/v1/presence/heartbeat        上报心跳（body 带 scope）
 *   GET    /api/v1/presence?scope=...         列出 scope 下的在线用户（**排除自己**）
 *   DELETE /api/v1/presence?scope=...         离开 scope
 *
 * 旧路由 `/presence/:modelId` 只是兼容层（main.go:431 注释「保留至 M14」），
 * 它只能表示 `model:<id>`，而 M12 之后前端编辑的是 package / view —— 用不了。
 *
 * 数据形状直接复用 lib/collab/types.ts 的 UserPresence（那是 M13 协同类型的
 * 唯一来源，SSE 推送与 REST 拉取共用同一个结构）。
 */

import { getApi } from './api';
import type { UserPresence } from '../lib/collab/types';

export interface HeartbeatOptions {
  /** 光标位置（行 / 列，1-based） */
  cursor?: { line: number; column: number };
  /** 选区范围 */
  selection?: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  /** 内容指纹：后端用它判断「别人正在编辑同一份内容」 */
  contentHash?: string;
}

export const presenceApi = {
  /** 列出 scope 下其他在线用户（后端已排除调用者自己） */
  async list(scope: string): Promise<UserPresence[]> {
    const api = getApi();
    const { data } = await api.get<UserPresence[]>('/presence', {
      params: { scope },
    });
    return data ?? [];
  },

  /** 上报心跳（让后端知道「我还在线」） */
  async heartbeat(scope: string, opts: HeartbeatOptions = {}): Promise<void> {
    const api = getApi();
    await api.post('/presence/heartbeat', {
      scope,
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
      ...(opts.selection ? { selection: opts.selection } : {}),
      ...(opts.contentHash ? { contentHash: opts.contentHash } : {}),
    });
  },

  /** 离开 scope（卸载时调用，避免留下「幽灵在线」） */
  async leave(scope: string): Promise<void> {
    const api = getApi();
    await api.delete('/presence', { params: { scope } });
  },
};
