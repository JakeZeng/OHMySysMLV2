# M13 — 多人协同 + 冲突解决 设计文档

> **里程碑**: M13 多人实时协同 + 三方合并（next/dev，2026-09-24）
> **方向记录**: 多人协同 + 冲突解决（goal: "你直接从方案设计到代码开发一条龙完成"）

---

## 1. 目标

把现有"乐观锁 + 失败刷新"模型升级为"持久化 presence + advisory lock + 三方合并 + 事件广播"，实现真正的多人协同编辑体验。

### 1.1 当前现状（M12.5d）

| 维度 | 现状 | 痛点 |
|------|------|------|
| 冲突检测 | 乐观锁版本号 → 409 `E_VERSION_CONFLICT` | 客户端只能 reload，**丢失本地编辑** |
| Presence | 内存 `map[string]map[string]*UserPresence`，按 `modelId`（旧 Model 实体） | 进程重启清空 + 不支持 Package/View |
| Comments | 内存 + `modelId` 旧路由 | 同上 |
| 通知 | 内存 + 不广播给其他用户 | 协作者不知道别人已保存 |
| 锁 | **不存在** | 多人同时编辑同一文件，频繁 409 |
| 实时推送 | 无（SSE/WebSocket 都没有） | A 保存后 B 看不到，要等下轮轮询 |
| 冲突 UI | 仅显示 "版本冲突，已刷新" | 无三方对比 / 无选择保留 |

### 1.2 M13 范围（做）

| # | 功能 | 类型 |
|---|------|------|
| **A** | Presence 持久化 + 迁移到 packageId/viewId | 后端 |
| **B** | Comments 持久化（SQLite 表）+ 迁移到 packageId/viewId | 后端 |
| **C** | 软锁 advisory lock（owner + TTL + 心跳续期） | 后端 + 前端 |
| **D** | 冲突时返回 409+diff（base / mine / theirs + hunks） | 后端 |
| **E** | 3-way merge UI：side-by-side + hunk 选择 | 前端 |
| **F** | SSE 事件流：content_updated / lock_changed / presence_update | 全栈 |
| **G** | 保存成功后通知协作者（toast + 通知中心） | 全栈 |
| **H** | 强制覆盖（force=true）+ 审计记录 | 后端 |

### 1.3 不做（明确排除）

- ❌ CRDT / OT（Yjs/Automerge）— M14+ 才考虑
- ❌ 操作转换 / 字符级实时同步
- ❌ WebRTC P2P
- ❌ 评论 @ 提及 / 邮件通知
- ❌ 锁的强制夺取（保留 5 分钟 TTL 让等待者自动接管）

---

## 2. 架构概览

```
┌──────────────────────────────────────────────────────────────────────┐
│  后端 (Go)                                                            │
│                                                                       │
│  ┌─ Presence 表 (SQLite) ──┐  ┌─ EditLocks 表 (SQLite) ───────┐      │
│  │ user_id + scope         │  │ scope + owner_id + expires_at │      │
│  │ last_seen + cursor      │  │ heartbeat 续期 (TTL 60s)      │      │
│  │ 启动时清理 30s+ 不活跃   │  │ 自动过期                          │      │
│  └──────────────────────────┘  └──────────────────────────────────┘      │
│                                                                       │
│  ┌─ Event Hub (内存 pub/sub) ─────────────────────────────────┐       │
│  │ channels: "package:<id>", "view:<id>"                    │       │
│  │ events: presence, lock_changed, content_updated          │       │
│  │ 每个 channel 一组订阅者 (chan []byte)                     │       │
│  └────────────────────────────────────────────────────────────┘       │
│       │                                                               │
│       ▼ SSE                                                           │
│  GET /api/v1/events/stream?scope=package:abc                          │
│                                                                       │
│  UpdatePackage/View 改进：                                              │
│   - 检查 req.Version != DB.Version                                   │
│   - 不匹配 → 409 { error.code: E_VERSION_CONFLICT,                    │
│                     error.details: { serverVersion, serverContent,    │
│                                      baseVersion, baseContent,        │
│                                      diffHunks: [...] } }             │
│   - req.Force=true → 直接 UPDATE（写 audit log "force_overwrite"）   │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  前端 (React + TS)                                                    │
│                                                                       │
│  useCollabStream(scope)  ── SSE consumer（自动重连）                  │
│  usePresence(scope)      ── heartbeat 5s + pull 3s                    │
│  useEditLock(scope)      ── acquire / heartbeat / release             │
│  ConflictModal           ── 3-way diff（base / mine / theirs）        │
│  LockBadge               ── 锁状态显示（"Bob 正在编辑 · 还剩 45s"）   │
│  CollabToast             ── "Bob 刚更新了这个包"                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据模型

### 3.1 新增 SQLite 表（migration `004_collaboration.up.sql`）

```sql
-- Presence — DB 持久化 + 自动过期清理
CREATE TABLE presence (
    scope TEXT NOT NULL,           -- "package:<id>" / "view:<id>" / "model:<id>"
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    color TEXT NOT NULL,
    cursor_line INTEGER,
    cursor_col INTEGER,
    sel_start_line INTEGER, sel_start_col INTEGER,
    sel_end_line INTEGER,   sel_end_col INTEGER,
    last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    content_hash TEXT,              -- 客户端周期性 hash 上报（用于"别人正在编辑"判定）
    PRIMARY KEY (scope, user_id)
);
CREATE INDEX idx_presence_scope_seen ON presence(scope, last_seen);

-- Edit Locks — advisory lock with TTL
CREATE TABLE edit_locks (
    scope TEXT PRIMARY KEY,         -- "package:<id>" / "view:<id>"
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    acquired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,  -- 默认 now + 60s
    base_version INTEGER NOT NULL   -- 锁建立时实体的版本号（解锁后其他人基于此 base 提交会冲突）
);

-- Package/View Comments — DB 持久化（M13 之前是内存）
CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,            -- "package:<id>" / "view:<id>" / "model:<id>"
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    element_id TEXT,
    line INTEGER,
    content TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_comments_scope ON comments(scope, created_at DESC);
```

### 3.2 错误响应格式升级

修改前（M12.5）：
```json
HTTP 409
{ "error": { "code": "E_VERSION_CONFLICT", "message": "版本冲突，请刷新后重试" } }
```

修改后（M13）：
```json
HTTP 409
{
  "error": {
    "code": "E_VERSION_CONFLICT",
    "message": "版本冲突：服务器已有更新版本",
    "details": {
      "resourceType": "package",          // 或 "view"
      "resourceId": "pkg_abc",
      "serverVersion": 7,
      "serverContent": "package Foo { ... }",
      "serverUpdatedAt": "2026-09-24T11:00:05Z",
      "serverUpdatedBy": "user_xyz",
      "baseVersion": 5,                   // 客户端拉到的版本
      "baseContent": "package Foo { ... }", // 客户端基于的版本内容（前端可从缓存取）
      "diffHunks": [                      // 简单 line-level diff（base vs server）
        { "type": "equal",  "baseStart": 1, "serverStart": 1, "count": 3 },
        { "type": "insert", "baseStart": 4, "serverStart": 4, "lines": ["new line A", "new line B"] },
        { "type": "delete", "baseStart": 4, "serverStart": 6, "count": 1 }
      ]
    }
  }
}
```

**客户端处理**：
- 收到此响应 → 弹出 `ConflictModal`
- 用户选择：使用我的版本（force=true）/ 使用服务器版本 / 三方合并（手动 hunk 选择）
- 强制覆盖 → POST/PUT with `force: true` + audit log

### 3.3 Lock 模型

| 行为 | 含义 |
|------|------|
| `POST /packages/:id/lock` (no body) | 尝试获取锁；若已被他人持有 → 409 + 当前持有者 |
| `POST /packages/:id/lock` (`?heartbeat=true`) | 续期（仅 owner） |
| `DELETE /packages/:id/lock` | 释放（owner 可释放；admin 可强制释放） |
| 锁过期 | 60s 无心跳自动失效，下个 `POST` 可接管 |
| 与乐观锁关系 | 锁只是**减少冲突**，不强制；其他人仍可 PUT（提交时仍会 409） |
| 锁的 baseVersion | 锁建立时实体的版本号；用户保存时若 `req.Version < lock.baseVersion` 也视为冲突 |

---

## 4. SSE 事件协议

```
GET /api/v1/events/stream?scope=package:pkg_abc
Accept: text/event-stream

→ data: {"type":"hello","scope":"package:pkg_abc","ts":"..."}

→ data: {"type":"presence","users":[{"userId":"u1","username":"Bob","color":"#3b82f6","contentHash":"abc123"}]}

→ data: {"type":"lock_changed","owner":{"userId":"u1","username":"Bob"},"expiresAt":"...","baseVersion":7}

→ data: {"type":"content_updated","by":{"userId":"u1","username":"Bob"},"newVersion":8,"ts":"..."}

→ data: {"type":"lock_released","by":{"userId":"u1","username":"Bob"}}

: keepalive (每 15s 注释行)

→ event: close
```

前端：`useCollabStream(scope)` hook：
- 自动重连（指数退避，1s → 2s → 5s → 10s）
- 重连时 fetch 一次 presence 快照补全
- 解析 → 派发到 store

---

## 5. 前端交互流程

### 5.1 保存流程（含锁 + 冲突）

```
用户按 Ctrl+S / 点击保存
  ↓
modelStore.saveContent()
  ├─ 若有锁 → 校验 lock.owner === currentUser.id，否则提示 "被 X 锁定，无法保存"
  ├─ PUT /packages/:id
  │     ├─ 200 → 更新 version，提示 "保存成功"，清 dirty
  │     └─ 409 + E_VERSION_CONFLICT + details
  │           ↓
  │       ConflictModal 弹出（显示 base/mine/theirs）
  │         ├─ "使用我的版本" → PUT { ..., force: true }
  │         ├─ "使用服务器版本" → store.version = serverVersion, content = serverContent
  │         └─ "逐 hunk 选择" → 编辑合并后的文本 → PUT
  └─ SSE: content_updated 事件 → 其他在线用户 toast "X 刚更新了 Y"
```

### 5.2 Lock 流程

```
进入 /projects/:pid?package=:id
  ↓
usePresence.startHeartbeat()              ← 5s 周期
useEditLock.tryAcquire() (best-effort)    ← 若失败则提示 "Bob 正在编辑（剩 45s）"
  ├─ 成功 → 显示 "你正在编辑 · 自动续期中"
  ├─ 失败 → 显示 "Bob 正在编辑 · 倒计时中"
  └─ 后台 SSE 监听 lock_changed / lock_released
  ↓
切走 / 关闭页面 → DELETE /lock
```

### 5.3 实时通知流程

```
A 编辑 → presence.contentHash 上报 → SSE 广播
B 收到 → 检查 hash 是否变（变了但 B 还没刷新本地内容）→ 显示 Banner "A 正在编辑这个包，最新修改时间是 5s 前"
A 保存成功 → SSE content_updated → B 收到 → 提示 "A 在 5s 前保存了 v8 版本，点此查看"
B 点击 → 弹三方对比 → 决定 merge / accept theirs
```

---

## 6. Diff 算法

实现简单的 **Myers diff**（行级）用于三方合并 UI：

- 输入：base / mine / theirs 三段文本
- 计算：mine vs base → mine 的 hunks；theirs vs base → theirs 的 hunks
- 输出：合并 hunks 列表，每行标记 `mine` / `theirs` / `both` / `neither`
- UI：每 hunk 4 个按钮（accept mine / accept theirs / accept both / skip）

后端 diff：实现一个轻量 `diff.Lines(base, server)` 函数，返回 `[]Hunk`（仅用于显示服务端改了什么，不做合并）。

前端 merge：复用后端 diff 库，或引入 `diff` npm 包（13K stars，依赖少）。

---

## 7. 测试与验收

### 7.1 后端测试

| 测试 | 关键场景 |
|------|----------|
| `TestPresence` | 上报心跳 → 列出在线（排除自己）→ 过期清理 |
| `TestEditLock_Acquire` | A 拿到锁，B 拿不到 → B POST 返 409 + owner info |
| `TestEditLock_Heartbeat` | A 心跳续期，B 等待 60s → 自动过期 → B 拿到锁 |
| `TestEditLock_Release` | A 释放 → B 立即可拿到 |
| `TestUpdatePackage_ConflictReturnsDiff` | baseVersion=5, serverVersion=7, PUT v5 → 409 + diffHunks |
| `TestUpdatePackage_Force` | 强制覆盖 → 写 audit log "force_overwrite" |
| `TestComments_MigrateFromModelId` | 旧 modelId 评论保留；新 packageId 评论走新表 |
| `TestSSE_Broadcast` | A subscribe → B save → A 收到 content_updated |

### 7.2 前端测试

| 测试 | 关键场景 |
|------|----------|
| `useCollabStream` | 自动重连、指数退避、清理订阅 |
| `useEditLock` | 拿锁 / 释放 / 心跳 / 失败 |
| `ConflictModal` | 三方对比、accept mine/theirs/both |
| `lockStore` | 全局锁状态广播 |

### 7.3 Playwright 自测

两窗口模拟：
1. A 打开 package → 拿到锁
2. B 打开同一 package → 看到 "A 正在编辑"
3. A 编辑 → A 保存 → B 收到 toast
4. A 编辑不保存，B 编辑 → B 保存 → A 收到冲突 modal

### 7.4 签收标准

- ✅ 后端编译通过（`go build ./...`）
- ✅ 前端 typecheck 通过
- ✅ 全部 vitest + go test 全绿
- ✅ Playwright 两窗口测试通过 + 截图归档
- ✅ 文档：本文件 + 更新 m11-summary.md → m13-summary.md
- ✅ 文档：api_design.md §5 加 7 个新端点

---

## 8. 关键决策

| 决策 | 结论 | 理由 |
|------|------|------|
| 实时推送协议 | **SSE** | 单向就够，浏览器原生 EventSource，自动重连，无需额外依赖 |
| Lock 实现 | **DB row + TTL** | 不需 Redis；与 SQLite 一致；TTL 自动过期 |
| Lock 语义 | **advisory（建议性）** | 不强制阻止他人 PUT；降低协作摩擦 |
| Diff 粒度 | **行级** | SysML 是结构化文本，行级足够；字符级复杂且性能差 |
| CRDT | **不做** | SysML 是声明式 DSL，结构冲突多，CRDT 收益小；MVP 用 merge UI |
| 强制覆盖 | **允许 + 审计** | 用户最终决策权；写 audit 留痕 |
| Presence 清理 | **lazy + periodic** | 读时清过期 + 后台 ticker 每 30s 全表扫 |

---

## 9. 文件清单（预计改动）

### 后端 (Go)

新增：
- `internal/model/presence.go` — Presence / EditLock / Comment（新表对应）
- `internal/handler/presenceHandler.go` — 重写：DB-backed
- `internal/handler/lockHandler.go` — 新文件
- `internal/handler/commentsHandler.go` — 重写：DB-backed，scope 通用化
- `internal/handler/eventsHandler.go` — SSE endpoint
- `internal/hub/hub.go` — 内存 pub/sub
- `internal/repository/repository.go` — 新增 Presence/EditLock/Comment repo methods
- `migrations/004_collaboration.up.sql` / `.down.sql`
- `internal/diff/lines.go` — 行级 diff
- `internal/handler/conflict.go` — 409 响应辅助

修改：
- `internal/handler/handler.go` — UpdatePackage/UpdateView 加 diff 详情 + force 参数
- `internal/model/audit.go` — 新增 `audit_force_overwrite` action
- `cmd/server/main.go` — 注册新 routes（lock / events）
- `openapi.yaml` — 新增 endpoints

### 前端 (React+TS)

新增：
- `src/services/presenceApi.ts` — heartbeat / list / leave
- `src/services/lockApi.ts` — acquire / release / heartbeat
- `src/services/commentsApi.ts` — 替换 CommentsPanel 内 fetch
- `src/hooks/useCollabStream.ts` — SSE consumer
- `src/hooks/useEditLock.ts`
- `src/stores/collabStore.ts` — presence + lock 状态
- `src/components/collab/PresenceAvatars.tsx` — 重写 PresenceIndicator 用新 scope
- `src/components/collab/LockBadge.tsx`
- `src/components/collab/ConflictModal.tsx` — 3-way merge UI
- `src/components/collab/CollabToasts.tsx`
- `src/lib/diff.ts` — wrapper over `diff` npm package

修改：
- `src/stores/modelStore.ts` — saveContent 处理新 409 格式 + 弹 ConflictModal
- `src/services/packageApi.ts` / `viewApi.ts` — 加 force 参数 / 接受新 409 details
- `src/services/api.ts` — axios interceptor 把 409 details 放到 ApiError.details
- `src/components/CommentsPanel.tsx` — 改用 commentsApi

新增依赖：
- `diff` (npm, ~50KB)

---

## 10. 不在范围（明确延后）

- 评论 @ 提及 / 邮件 / Slack 通知
- 锁的强制夺取 UI（admin 才能）
- 锁的等待队列 / 转让
- 移动端推送
- 离线编辑 + 同步（IndexedDB → 服务端）
- CRDT / Yjs
- 多文件批量锁

---

## 11. 里程碑拆分（实施顺序）

| Phase | 内容 | 估时 |
|-------|------|------|
| M13.0 | DB migration + Presence + Comments 表 | 30min |
| M13.1 | Hub pub/sub + SSE endpoint | 20min |
| M13.2 | Lock handler + repo | 30min |
| M13.3 | UpdatePackage/View 改 409+diff + force | 40min |
| M13.4 | 后端 tests | 20min |
| M13.5 | 前端 useCollabStream + presence/lock stores | 30min |
| M13.6 | 前端 LockBadge + PresenceAvatars 重写 | 30min |
| M13.7 | 前端 ConflictModal + 3-way merge | 60min |
| M13.8 | modelStore.saveContent 接入新流程 | 30min |
| M13.9 | 前端 tests + Playwright 双窗口 | 60min |
| M13.10 | 文档 + memory + commit | 20min |

总计 ~6h 集中开发。

---

## 12. 引用源

- SysML v2 §7.26 Views and Viewpoints（同 M12 引用）
- [diff-match-patch](https://github.com/google/diff-match-patch) — Google diff 库参考
- [diff (npm)](https://github.com/kpdecker/jsdiff) — 选用的轻量 diff 库
- [Server-Sent Events spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Optimistic concurrency control](https://en.wikipedia.org/wiki/Optimistic_concurrency_control)
- [Three-way merge](https://en.wikipedia.org/wiki/Merge_(version_control)#Three-way_merge)
