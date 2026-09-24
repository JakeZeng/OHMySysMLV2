/**
 * M13 协同类型定义
 *
 * 涵盖 presence / lock / conflict / SSE event 四类。
 *
 * 后端对应实现：
 *   - handler/presenceHandler.go   (HeartbeatRequest / PresenceResponse)
 *   - handler/lockHandler.go       (LockResponse / AcquireLockRequest)
 *   - handler/conflict.go          (buildConflictDetails)
 *   - handler/eventsHandler.go     (writeSSE)
 */

export type ScopeKind = 'package' | 'view' | 'model';

/** scope 字符串：'package:<id>' | 'view:<id>' | 'model:<id>' */
export function makeScope(kind: ScopeKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseScope(scope: string): { kind: ScopeKind; id: string } {
  const idx = scope.indexOf(':');
  if (idx < 0) return { kind: 'model', id: scope };
  const k = scope.slice(0, idx) as ScopeKind;
  const id = scope.slice(idx + 1);
  return { kind: k, id };
}

// ─── Presence ──────────────────────────────────────────────

/** 单条在线用户信息（前端使用） */
export interface UserPresence {
  userId: string;
  username: string;
  color: string;
  cursor?: { line: number; column: number };
  selection?: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  contentHash: string;
  lastSeen: string;
}

// ─── Edit Lock ──────────────────────────────────────────────

/** 后端 lock 响应（owner=undefined 表示无锁） */
export interface LockResponse {
  scope: string;
  owner?: { userId: string; username: string };
  acquiredAt?: string;
  expiresAt?: string;
  baseVersion?: number;
}

// ─── Conflict ──────────────────────────────────────────────

/** diff hunk（与后端 diff.Hunk 形状一致） */
export interface DiffHunk {
  type: 'equal' | 'insert' | 'delete';
  baseStart?: number;
  serverStart?: number;
  count?: number;
  lines: string[];
}

/** 409 E_VERSION_CONFLICT 响应 details */
export interface ConflictDetails {
  resourceType: 'package' | 'view';
  resourceId: string;
  serverVersion: number;
  serverContent: string;
  serverUpdatedAt: string;
  serverUpdatedBy: string;
  baseVersion: number;
  baseContent: string;
  diffHunks: DiffHunk[];
}

/** 合并选项（用户操作） */
export type MergeStrategy =
  | 'mine'           // 强制用我的（force overwrite）
  | 'theirs'         // 接受服务器
  | 'manual';        // 手动合并（已编辑 mergedContent）

// ─── SSE Events ─────────────────────────────────────────────

/** 服务端推送的事件类型 */
export type CollabEventType =
  | 'hello'
  | 'presence'
  | 'lock_changed'
  | 'lock_released'
  | 'content_updated'
  | 'comment_added'
  | 'comment_resolved'
  | 'comment_removed';

export interface CollabEvent {
  type: CollabEventType;
  data: unknown;
}