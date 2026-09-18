# M4 团队空间 + 模型分享 — 交付总结

> 三阶段交付：W1（授权基础）→ W2（团队空间）→ W3（模型分享）+ M4.5 增量。
> 所有阶段按计划完成，无范围裁剪。

---

## 交付清单

### M4.5 增量（commit `f3cca0c` / `c94f861` / `e8aa23a` / `c60144c` / `2a66f84` / `583f080` / `dae6a87` / `c081765` / `de500b1` / `283299e` / `797b1c0` / `23ad302`）

| 项 | 内容 |
|----|------|
| 用户搜索端点 | `GET /api/v1/users/search?q=&limit=`，250ms debounce 自动解析 username → userId |
| 项目可见性 UI 切换 | ProjectDetail 加 radio 切换 private/team/public |
| share-link 用量统计 | ViewCount + LastViewedAt；列表显示访问次数 + tooltip |
| CSRF 严格模式 | `StrictCSRFConfig()` + `CSRF_STRICT=true` env 切换 |
| Team project-access UI | TeamDetail 加"授权项目"按钮 + modal + revoke 按钮 |
| Team access 显示项目名 | JOIN projects 显示项目名 + 可见性徽章（替换 raw UUID） |
| 审计日志 backend | audit_logs 表 + GET /api/v1/audit-logs（actor / target 过滤） |
| 审计日志 frontend | AuditLogPage（filter UI + 时间倒序列表 + 颜色编码） |
| 审计日志覆盖范围 | share / unshare / link_create / link_revoke / team_create / member_add / member_role / member_del / grant / revoke / project CRUD / model CRUD / register / login / login_fail / link_rotate |
| Share-link maxViews | `MaxViews *int`；超限后链接自动 404（与 revoked / expired uniform 响应） |
| 公开页 Monaco 只读渲染 | SharedProjectPage 点模型行展开 SysMLEditor(readOnly=true) |
| Share-link rotation API | `POST /projects/:id/links/:linkId/rotate`：撤销旧 token + 生成新 token，保留审计连续性 |

### W1 — 授权基础（commit `ae0ea15`）

- `handler/authz.go`：Permission 枚举（read/write/admin）+ 5 个跨切面 helper
  - `hasProjectAccess` / `loadAccessibleProject` / `loadAccessibleModel` / `resolveTeamMemberRole` / 权限字符串解析
- `repository.go`：
  - `projects.visibility (private|team|public)` 列新增 + CHECK 约束
  - 5 张新表：`teams` / `team_members` / `team_project_access` / `project_shares` / `share_links`
  - `PRAGMA foreign_keys = ON` 启用真正的级联删除
  - `ListAccessibleProjects(userID)` 用 UNION 跨 owner/team-share/direct-share 三路
- 11 个现有 project/model 端点全部接上资源级授权
- 前端：`VisibilityBadge` + 项目列表 mine/team/shared 三组分组 + 项目详情 role 徽章

### W2 — 团队空间（commit `f76dede`）

- 后端：`model/team.go` + `repository/team.go` + `handler/teamHandler.go`
  - 9 个 team 端点 + 9 个 teamMember/project-access 端点
  - **last-owner 保护**：`UpdateTeamMemberRole` + `RemoveTeamMember` 两处
  - 创建团队用 `inTx` 原子化（team + team_members 同事务）
- 前端：`/teams`、`/teams/:id` 路由 + `CreateTeamModal` + `InviteMemberModal` + `TeamsPage` + `TeamDetailPage`
- TopNav 新增 Projects/Teams/Metamodel 链接
- CSRF skip 列表加入 `/api/v1/teams` 与 `/api/v1/teams/*`
- 测试：`teamHandler_test.go` 6 项全绿

### W3 — 模型分享（本次 commit）

- 后端：`model/share.go` + `repository/share.go` + `handler/shareHandler.go`
  - 6 个授权端点（`/projects/:id/shares`、`/projects/:id/links`）
  - 1 个公开端点（`/shared/:token`）
  - **Token 策略**：`crypto/rand` 16 bytes → base64url（22 字符，128 位熵）；DB 仅存 SHA-256 hash，明文仅创建时返回一次
  - **统一 404**：revoked / expired / not-found 都返回相同 message + 404，防时序/类型泄露
  - **独立限流器**：20 req/min/IP（公开端点）
  - 链接权限仅 `read` / `write`，不允许 `admin`（匿名权限失控风险）
- CSRF skip 列表加入 `/api/v1/shared` + `/api/v1/shared/*`
- 前端：`services/shareApi.ts` + `components/modals/ShareSettingsModal.tsx` + `pages/SharedProjectPage.tsx`
  - `ProjectDetail` 加入 owner-only "分享设置" 入口
  - 公开页 `/shared/:token` 无需登录，展示只读视图（不含 model content）
- 测试：`shareHandler_test.go` 6 项全绿

---

## 验证矩阵

| 维度 | 命令 / 文件 | 结果 |
|------|------------|------|
| 后端编译 | `cd poc-v2/backend && go build ./...` | ✅ 无输出（success） |
| 后端测试 | `go test -count=1 ./...` | ✅ 全部包 PASS（handler / repository / ai / metamodel / middleware / templates） |
| 前端类型 | `cd poc-v2/frontend && tsc --noEmit` | ✅ 无输出 |
| 前端构建 | `vite build` | ✅ dist/ 产物（2.26 MB JS / 40 KB CSS） |

### W3 测试覆盖（`shareHandler_test.go`）

| 测试 | 验证 |
|------|------|
| `TestW3_DirectShareCRUD` | owner 添加/列出/撤销 shares；非 owner 列出应 403；重复撤销 404 |
| `TestW3_LinkCreateAndAccess` | 生成 link → 公开 GET 拿到项目元数据；坏 token 404 |
| `TestW3_LinkRevoke` | revoke 后原 token 失效 404 |
| `TestW3_LinkPermissionRejectedAdmin` | `permission=admin` 应 400（绑定限制） |
| `TestW3_LinkExpiration` | `expires_at` 设为过去 → 404 |
| `TestW3_AnonymousCannotWrite` | 即使 link 持 write，公开端点只 GET 元数据；models 数组不含 content 字段 |

---

## 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Token 存储 | 仅存 SHA-256 hash | DB 泄露不会暴露明文 token |
| Token 熵 | 16 bytes / 128 位 | base64url 22 字符，独立限流 20/min/IP 防爬虫 |
| 链接 admin 权限 | 禁止 | 匿名场景下 admin 风险过高；必须通过 user/team 显式分享 |
| 失效响应 | 统一 404 + 通用 message | 防时序攻击 / 防类型泄露 |
| Project owner | 永远是 admin | 不入 project_shares 表，避免与 owner 状态不一致 |
| Visibility=team + 用户不在 team | 不可见 | 即使有 share_link 也仅允许公开 token 访问 |
| 公开限流 | 独立 `RateLimiter(20, time.Minute)` | 与登录用户的 60/min 区分；公开场景更严 |
| CSRF skip | /shared/* + /projects/* | dev 模式兼容；生产应切换严格模式 |

---

## 文件清单

### W3 新增
```
poc-v2/backend/internal/model/share.go
poc-v2/backend/internal/repository/share.go
poc-v2/backend/internal/handler/shareHandler.go
poc-v2/backend/internal/handler/shareHandler_test.go
poc-v2/frontend/src/services/shareApi.ts
poc-v2/frontend/src/components/modals/ShareSettingsModal.tsx
poc-v2/frontend/src/pages/SharedProjectPage.tsx
poc-v2/docs/m4-summary.md
```

### W3 修改
```
poc-v2/backend/cmd/server/main.go                          # 注册 share + /shared/:token + 独立限流
poc-v2/backend/internal/handler/handler_test.go            # setupTestRouter 加 share 路由
poc-v2/backend/internal/middleware/security.go             # CSRF skip +2
poc-v2/frontend/src/pages/ProjectDetail.tsx                # 加 "分享设置" 入口（owner only）
poc-v2/frontend/src/routes.tsx                             # 加 /shared/:token 公开路由
```

### 不在 M4 范围（推迟）
- 邮件邀请、SMS 通知
- 实时协同（CRDT，timeline §2.5 明确不做）
- WebSocket 推送（轮询替代）
- 版本粒度的分享（M5）
- 密码哈希升级（sha256+salt → bcrypt）
- 真实 migration runner

---

## 后续优化建议（M5+）

1. **审计日志归档策略**：大表 + 时间分区 / 冷热分离
2. **audit-log 角色过滤**：当前任何登录用户可看所有审计，生产应按项目/团队成员关系收紧
3. **公开页速率监控**：监测 share-link 流量异常（爬虫 / 滥用）
4. **审计导出 CSV / SIEM 集成**：合规需要