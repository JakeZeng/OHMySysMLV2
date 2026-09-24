/**
 * M13 SSE 事件流消费者。
 *
 * 用法：
 *   useCollabStream(scope);  // scope 变化自动重连
 *
 * 行为：
 *   - 打开 EventSource 到 /api/v1/events/stream?scope=...
 *   - 解析 event: + data: → 分派到 collabStore
 *   - 自动重连（最多 5 次，指数退避）
 *   - scope 变化 → 关闭旧连接、打开新连接
 */

import * as React from 'react';
import { getApi } from '../services/api';
import { useCollabStore } from '../stores/collabStore';
import type {
  CollabEvent,
  CollabEventType,
  LockResponse,
  UserPresence,
} from '../lib/collab/types';

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

    // 用 EventSource（fetch 不支持 SSE）。
    // 注意：getApi() 的 baseURL 是 '/api/v1'，EventSource 用相对路径。
    const url = `/api/v1/events/stream?scope=${encodeURIComponent(scope)}`;
    let es: EventSource | null = null;
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
      es = new EventSource(url, { withCredentials: true });

      es.onopen = () => {
        reconnectAttempt = 0;
        setConnected(true);
        setLastError(null);
      };

      // 通用事件类型监听
      const eventNames: CollabEventType[] = [
        'hello',
        'presence',
        'lock_changed',
        'lock_released',
        'content_updated',
        'comment_added',
        'comment_resolved',
        'comment_removed',
      ];
      for (const name of eventNames) {
        es.addEventListener(name, (ev: MessageEvent) => {
          dispatch(name, ev.data);
        });
      }

      // 服务器默认 event: <type> data: <json> 已经按类型分派；
      // 但 EventSource 的 'message' 事件兜底处理
      es.onmessage = (ev) => {
        // 没有 event: 行时走这里
        const m = JSON.parse(String(ev.data)) as CollabEvent;
        handleEvent(m.type, m.data as { [k: string]: unknown });
      };

      es.onerror = () => {
        // readyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
        if (cancelled) return;
        setConnected(false);
        if (reconnectAttempt >= optsRef.current.maxReconnect) {
          setLastError('SSE 连接已断开（已重试上限）');
          return;
        }
        const delay =
          optsRef.current.reconnectDelay * Math.pow(2, reconnectAttempt);
        reconnectAttempt++;
        setLastError(`SSE 断开，${delay}ms 后重试…`);
        es?.close();
        es = null;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) {
        es.close();
        es = null;
      }
      setConnected(false);
    };
    // 故意只依赖 scope；opts 不在依赖中（用 ref）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  return { connected, lastError };
}