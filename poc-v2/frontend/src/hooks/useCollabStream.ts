/**
 * M13 SSE 事件流消费者。
 *
 * 用法：
 *   useCollabStream(scope);  // scope 变化自动重连
 *
 * 行为：
 *   - 打开 **fetch 流**到 /api/v1/events/stream?scope=...
 *   - 解析 event: + data: → 分派到 collabStore
 *   - 自动重连（最多 5 次，指数退避）
 *   - scope 变化 → 关闭旧连接、打开新连接
 *
 * ## ⚠️ 为什么不用 EventSource（M19 第八轮修的真 bug）
 *
 * 原实现用 `new EventSource(url, { withCredentials: true })`。
 * **EventSource 不支持自定义请求头** —— 带不上 `Authorization: Bearer <jwt>`，
 * 而后端的 `middleware.AuthRequired()` 只认这个头（`internal/middleware/jwt.go:120`）
 * → `/api/v1/events/stream` **永远返回 401**。
 *
 * 后果（不是「某个功能坏了」，是**整条协同通道从来没通过**）：
 *   - 评论新增 / 解决 / 删除的实时推送（`comment_added`）—— 收不到
 *   - presence 快照推送（`presence`）—— 收不到
 *   - 锁变更推送（`lock_changed` / `lock_released`）—— 收不到
 *   - 内容更新推送（`content_updated`）—— 收不到
 *
 * 实测（e2e 抓出）：页面里 EventSource 反复重连，每次都是 401。
 *
 * 改成 `fetch` + `ReadableStream` 手动读 SSE 帧（与 `services/aiApi.ts` 的
 * 流式读取同款），**token 放在请求头里，不进 URL**（进 URL 会落到
 * access log / Referer / 浏览器历史里）。
 */

import * as React from 'react';
import { getApi } from '../services/api';
import { useCollabStore } from '../stores/collabStore';
import type {
  CollabEventType,
  LockResponse,
  UserPresence,
} from '../lib/collab/types';

/** authStore 存 token 的 localStorage key */
const TOKEN_STORAGE_KEY = 'sysmlv2.token';

/**
 * 解析一段 SSE 文本 → 事件列表。
 *
 * SSE 帧格式（后端 `writeSSE`）：
 *
 *     event: comment_added
 *     data: {"scope":"package:x","comment":{…}}
 *
 * 以空行分隔；`: keepalive` 是注释行（后端 15s 一次保活），要忽略。
 *
 * 导出成纯函数是为了能单测（帧边界常在 chunk 中间，不能按 chunk 解析）。
 */
export function parseSseFrames(buffer: string): { frames: Array<{ type: string; data: string }>; rest: string } {
  const frames: Array<{ type: string; data: string }> = [];
  // 兼容 \n\n 与 \r\n\r\n 两种分隔
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    let type = 'message';
    const dataLines: string[] = [];
    for (const line of part.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue; // 注释 / 保活
      if (line.startsWith('event:')) {
        type = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) continue;
    frames.push({ type, data: dataLines.join('\n') });
  }
  return { frames, rest };
}

interface UseCollabStreamOptions {
  /** 重连最大次数；默认 5 */
  maxReconnect?: number;
  /** 重连初始延迟（ms）；默认 1000 */
  reconnectDelay?: number;
}

export function useCollabStream(
  scope: string | null,
  opts: UseCollabStreamOptions = {},
): { connected: boolean; lastError: string | null } {
  const { maxReconnect = 5, reconnectDelay = 1000 } = opts;
  const setConnected = useCollabStore((s) => s.setConnected);
  const setLastError = useCollabStore((s) => s.setLastError);
  const setPresence = useCollabStore((s) => s.setPresence);
  const setLock = useCollabStore((s) => s.setLock);
  const setActiveScope = useCollabStore((s) => s.setActiveScope);
  const connected = useCollabStore((s) => s.connected);
  const lastError = useCollabStore((s) => s.lastError);

  // 防止 Effect 内访问 stale closure：用 ref
  const optsRef = React.useRef({ maxReconnect, reconnectDelay });
  optsRef.current = { maxReconnect, reconnectDelay };

  React.useEffect(() => {
    if (!scope) {
      setActiveScope(null);
      setConnected(false);
      return;
    }
    setActiveScope(scope);

    // 用 **fetch + ReadableStream** 读 SSE（EventSource 带不了 Authorization 头 → 401）。
    // 注意：getApi() 的 baseURL 是 '/api/v1'，这里要拼绝对路径。
    const api = getApi();
    const baseURL = (api.defaults?.baseURL ?? '').replace(/\/+$/, '');
    const url = `${baseURL}/events/stream?scope=${encodeURIComponent(scope)}`;
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    let controller: AbortController | null = null;
    let reconnectAttempt = 0;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function dispatch(eventName: string, dataStr: string) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        return; // keepalive 等非 JSON 行
      }
      const data = parsed as { type?: string; [k: string]: unknown };
      handleEvent(eventName as CollabEventType, data);
    }

    function handleEvent(type: CollabEventType, data: { [k: string]: unknown }) {
      switch (type) {
        case 'hello':
          // 连接握手；不修改 store
          break;
        case 'presence': {
          const users = (data.users as UserPresence[]) ?? [];
          setPresence(users);
          break;
        }
        case 'lock_changed': {
          const lock: LockResponse = {
            scope: scope!,
            owner: data.owner as { userId: string; username: string } | undefined,
            expiresAt: data.expiresAt as string | undefined,
            baseVersion: data.baseVersion as number | undefined,
          };
          setLock(lock.owner ? lock : null);
          break;
        }
        case 'lock_released':
          setLock(null);
          break;
        case 'content_updated':
          // 由调用 store 订阅者自行决定是否重载；这里只触发一次"需要重载"信号
          // （modelStore 订阅 activeScope 变化即可触发重载）
          window.dispatchEvent(
            new CustomEvent('collab:content-updated', { detail: { scope } }),
          );
          break;
        case 'comment_added':
        case 'comment_resolved':
        case 'comment_removed':
          window.dispatchEvent(
            new CustomEvent('collab:comments-changed', { detail: { scope } }),
          );
          break;
        default:
          // 未知事件：忽略
          break;
      }
    }

    function connect() {
      if (cancelled) return;
      controller = new AbortController();

      fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        signal: controller.signal,
      })
        .then(async (resp) => {
          if (!resp.ok) {
            throw new Error(`SSE ${resp.status}`);
          }
          reconnectAttempt = 0;
          setConnected(true);
          setLastError(null);

          const reader = resp.body?.getReader();
          if (!reader) throw new Error('无法读取 SSE 流');
          const decoder = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { frames, rest } = parseSseFrames(buffer);
            buffer = rest;
            for (const f of frames) {
              dispatch(f.type, f.data);
            }
          }
          // 流正常结束（后端重启等）→ 走重连
          throw new Error('SSE 流已结束');
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setConnected(false);
          if (reconnectAttempt >= optsRef.current.maxReconnect) {
            setLastError('SSE 连接已断开（已重试上限）');
            return;
          }
          const delay =
            optsRef.current.reconnectDelay * Math.pow(2, reconnectAttempt);
          reconnectAttempt++;
          setLastError(`SSE 断开，${delay}ms 后重试…（${String(err)}）`);
          reconnectTimer = setTimeout(connect, delay);
        });
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (controller) {
        controller.abort();
        controller = null;
      }
      setConnected(false);
    };
    // 故意只依赖 scope；opts 不在依赖中（用 ref）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  return { connected, lastError };
}