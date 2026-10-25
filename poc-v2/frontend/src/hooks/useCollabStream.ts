/**
 * M13 SSE 事件流消费者。
 *
 * 用法：
 *   useCollabStream(scope);  // scope 变化自动重连
 *
 * 行为：
 *   - 打开 **fetch 流**到 /api/v1/events/stream?scope=...
 *   - 解析 event: + data: → 分派到 collabStore
 *   - 自动重连（指数退避 + 封顶；**永不放弃**，与 EventSource 一致）
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
  /**
   * 连续失败多少次后**彻底放弃**。
   *
   * 默认 `Infinity` —— 与浏览器原生 `EventSource` 一致（它会一直重连）。
   * ⚠️ 早先的实现默认 5 次，5 次失败后**永久放弃** → 用户不刷新页面就再也
   * 收不到实时事件（后端重启一次、网络抖一下就中招）。EventSource 免费给的
   * 语义必须自己补上。
   */
  maxReconnect?: number;
  /** 重连初始延迟（ms）；默认 1000 */
  reconnectDelay?: number;
  /** 重连退避上限（ms）；默认 30000 */
  maxDelay?: number;
}

/**
 * 第 `attempt` 次失败后的重连延迟（ms）。
 *
 * 指数退避 + **封顶**：`base * 2^attempt`，但不超过 `maxDelay`。
 * 不封顶的话第 20 次失败要等 10^6 秒（约 11 天）—— 那不叫重连。
 *
 * 导出成纯函数是为了能单测（退避语义是「EventSource 免费给」的一部分，
 * 自己实现就必须钉死）。
 */
export function nextReconnectDelay(
  attempt: number,
  base = 1000,
  max = 30_000,
): number {
  const raw = base * Math.pow(2, attempt);
  return Math.min(Number.isFinite(raw) ? raw : max, max);
}

/**
 * 是否彻底放弃重连。
 *
 * 默认 `maxReconnect = Infinity` → 永不放弃（与 EventSource 一致）。
 * 显式传有限值时才会在达到上限后停下。
 */
export function shouldGiveUp(attempt: number, maxReconnect: number): boolean {
  return attempt >= maxReconnect;
}

export function useCollabStream(
  scope: string | null,
  opts: UseCollabStreamOptions = {},
): { connected: boolean; lastError: string | null } {
  const {
    maxReconnect = Number.POSITIVE_INFINITY,
    reconnectDelay = 1000,
    maxDelay = 30_000,
  } = opts;
  const setConnected = useCollabStore((s) => s.setConnected);
  const setLastError = useCollabStore((s) => s.setLastError);
  const setPresence = useCollabStore((s) => s.setPresence);
  const setLock = useCollabStore((s) => s.setLock);
  const setActiveScope = useCollabStore((s) => s.setActiveScope);
  const connected = useCollabStore((s) => s.connected);
  const lastError = useCollabStore((s) => s.lastError);

  // 防止 Effect 内访问 stale closure：用 ref
  const optsRef = React.useRef({ maxReconnect, reconnectDelay, maxDelay });
  optsRef.current = { maxReconnect, reconnectDelay, maxDelay };

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
      // token **每次连接时重读** —— 登出再登入后 token 变了，
      // 下一次重连要能用新的（早先只在 effect 建立时读一次，
      // 拿着过期 token 重连多少次都是 401）。
      const token = localStorage.getItem(TOKEN_STORAGE_KEY);

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
              // ⚠️ 退避计数**收到第一个帧才归零**。
              // 若在 HTTP 200 时就归零，「连上就被掐断」的场景退避永远回到 1s
              // → 变成每秒一次的紧密重连循环（浏览器 EventSource 默认最小间隔 ~3s）。
              reconnectAttempt = 0;
              dispatch(f.type, f.data);
            }
          }
          // 流正常结束（后端重启等）→ 走重连
          throw new Error('SSE 流已结束');
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setConnected(false);
          if (shouldGiveUp(reconnectAttempt, optsRef.current.maxReconnect)) {
            setLastError('SSE 连接已断开（已重试上限）');
            return;
          }
          const delay = nextReconnectDelay(
            reconnectAttempt,
            optsRef.current.reconnectDelay,
            optsRef.current.maxDelay,
          );
          reconnectAttempt++;
          setLastError(`SSE 断开，${Math.round(delay / 1000)}s 后重试…（${String(err)}）`);
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