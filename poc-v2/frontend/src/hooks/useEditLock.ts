/**
 * M13 编辑锁 hook。
 *
 * 行为：
 *   - mount 时尝试 acquire（heartbeat=false）
 *   - 每 30s 续期一次（heartbeat=true）
 *   - unmount 时 release
 *   - 冲突（409 E_LOCK_HELD）通过回调通知
 *
 * 用法：
 *   const { status, error } = useEditLock(scope, { onLost });
 */

import * as React from 'react';
import { getApi, ApiError } from '../services/api';
import type { LockResponse, ScopeKind } from '../lib/collab/types';
import { makeScope } from '../lib/collab/types';
import { useCollabStore } from '../stores/collabStore';

export type LockStatus = 'idle' | 'acquiring' | 'held' | 'conflict' | 'error';

interface UseEditLockOptions {
  /** 自定义心跳间隔（ms），默认 30000 */
  heartbeatMs?: number;
  /** 自定义 TTL（秒） */
  ttlSeconds?: number;
  /** 锁丢失/被他人抢占时触发（页面提示） */
  onLost?: (info: { ownerUserId: string; ownerUsername: string }) => void;
  /** 启用后才会发起 acquire；默认 true */
  enabled?: boolean;
}

interface UseEditLockResult {
  status: LockStatus;
  error: string | null;
  /** 当前 scope 的最新锁状态（来自 server） */
  lock: LockResponse | null;
}

export function useEditLock(
  scope: string | null,
  opts: UseEditLockOptions = {},
): UseEditLockResult {
  const { heartbeatMs = 30000, ttlSeconds = 60, onLost, enabled = true } = opts;
  const setLock = useCollabStore((s) => s.setLock);
  const baseVersion = useCollabStore((s) => s.baseVersion);
  const [status, setStatus] = React.useState<LockStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [lock, setLocalLock] = React.useState<LockResponse | null>(null);
  const onLostRef = React.useRef(onLost);
  onLostRef.current = onLost;

  // 用 ref 保持心跳定时器与 acquire 调用的最新值
  const ttlRef = React.useRef(ttlSeconds);
  ttlRef.current = ttlSeconds;
  const hbRef = React.useRef(heartbeatMs);
  hbRef.current = heartbeatMs;

  React.useEffect(() => {
    if (!scope || !enabled) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let lostTimer: ReturnType<typeof setTimeout> | null = null;

    async function doAcquire(heartbeat: boolean) {
      if (cancelled) return;
      if (!scope) return;
      const api = getApi();
      const [, kindAndId] = scope.split(':');
      const kind = scope.split(':')[0] as ScopeKind;
      try {
        const res = await api.post<LockResponse>(
          `/locks/${kind}/${kindAndId}`,
          {
            baseVersion,
            ttlSeconds: ttlRef.current,
            heartbeat,
          },
        );
        if (cancelled) return;
        const data = res.data;
        setLocalLock(data ?? null);
        setLock(data ?? null);
        setStatus(data?.owner ? 'held' : 'idle');
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const err = e as ApiError;
        if (err.status === 409 && (err.code === 'E_LOCK_HELD' || err.code === 'E_LOCK_NOT_OWNED')) {
          setStatus('conflict');
          // 重新拉取锁状态
          try {
            const fresh = await api.get<LockResponse>(`/locks/${kind}/${kindAndId}`);
            if (cancelled) return;
            setLocalLock(fresh.data ?? null);
            setLock(fresh.data ?? null);
            if (fresh.data?.owner) {
              onLostRef.current?.({
                ownerUserId: fresh.data.owner.userId,
                ownerUsername: fresh.data.owner.username,
              });
            }
          } catch {
            /* ignore */
          }
          setError('锁已被他人持有');
        } else {
          setStatus('error');
          setError(err.message);
        }
      }
    }

    // 初始 acquire
    setStatus('acquiring');
    void doAcquire(false);

    // 心跳
    heartbeatTimer = setInterval(() => {
      void doAcquire(true);
    }, hbRef.current);

    // 检查过期兜底（每 5s 检查一次 expiresAt）
    lostTimer = setInterval(() => {
      const cur = useCollabStore.getState().lock;
      if (cur?.expiresAt) {
        const exp = new Date(cur.expiresAt).getTime();
        if (!Number.isNaN(exp) && Date.now() > exp) {
          // 锁即将过期；让下一次心跳去续
        }
      }
    }, 5000);

    return () => {
      cancelled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (lostTimer) clearInterval(lostTimer);
      // release
      if (scope) {
        const api = getApi();
        const [, kindAndId] = scope.split(':');
        const kind = scope.split(':')[0] as ScopeKind;
        api.delete(`/locks/${kind}/${kindAndId}`).catch(() => undefined);
      }
      setLocalLock(null);
      setLock(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, enabled, baseVersion]);

  return { status, error, lock };
}