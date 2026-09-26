# Package 建模功能点 — 实施计划（v1.3 完成版）

**版本**: 1.3
**日期**: 2026-09-26
**状态**: ✅ 实施完成 + 全量测试通过（后端 8 packages ok，前端根 183 / frontend 215）

---

## 1. 用户真实意图

| 需求 | 含义 |
|---|---|
| 1. 项目创建时自动生成默认 Package | 进入新项目时已经有一个根 Package 可用，无需手动建第一个包 |
| 2. 拖到元素上 = 加嵌套成员 | 拖到 def 类 → 嵌到 body；拖到 usage → 拒绝（toast 报错） |
| 3. 树拖拽重排 Package 嵌套 | 树节点可拖动改变 `parent_package_id`（右键"移动到顶级"也可） |

---

## 2. 实施清单（全部完成）

### 改动 A：项目创建时自动建默认根 Package（与项目同名）

| 子项 | 状态 |
|---|---|
| A1 后端 `CreateProject` 事务内创建默认 Package（含失败回滚） | ✅ |
| A2 测试 `TestCreateProjectAutoRootPackage` | ✅ |
| A3 现有 `TestPackagesCRUD/List` 期望值由 1 改为 2（默认 + 新建） | ✅ |

### 改动 B：拖拽落点区分（def/usage/空白）

| 子项 | 状态 |
|---|---|
| B1 `DiagramCanvas` hover nodeId 跟踪 + onDrop 第三个参数 | ✅ |
| B2 `textOps` 新增 `canNest()` + `insertSnippetIntoElement()` | ✅ |
| B3 `ModelingPane.handlePaletteDrop` 接受 hoveredNodeId + 三分支逻辑 | ✅ |
| B4 视觉反馈：def 绿框 / usage 红框（CSS `rf-palette-drop-ok` / `rf-palette-drop-bad`） | ✅ |
| B5 测试 `canNest` + `insertSnippetIntoElement` 7 个用例 | ✅ |

### 改动 C：树拖拽重排 Package 嵌套

| 子项 | 状态 |
|---|---|
| C1 后端 `UpdatePackage` 环检测（self + descendant + 跨项目） | ✅ |
| C2 前端 `TreeRow` 接受 `onPackageDragStart/Over/Drop/Leave` props + 拖拽样式 | ✅ |
| C3 前端 `ProjectTree` 实现拖拽 handlers + `packageDropTargetId` state + 全局 `dragend` 清空 | ✅ |
| C4 后端测试 `TestPackageMoveCycle`（自环 / 后代环 / 跨项目 / 合法移顶） | ✅ |
| C5 前端 `menuItems` 新增"移动到顶级"菜单项 + `move-package` TreeAction | ✅ |
| C6 `ProjectDetail` 新增 `handleMovePackage` + switch case | ✅ |
| C7 `menuItems.test.ts` 期望值新增 `move-to-top` | ✅ |

---

## 3. 测试结果

| 测试套件 | 文件 | Tests | 状态 |
|---|---|---|---|
| `poc-v2` 根 vitest | 12 files | 183 passed | ✅ |
| `poc-v2/frontend` vitest | 19 files | 215 passed | ✅ |
| `poc-v2/backend` go test | 8 packages | 全部 ok | ✅ |

---

## 4. 关键文件变更

### 后端
- [poc-v2/backend/internal/handler/handler.go](file:///f:/code/repos/OHMySysMLV2/poc-v2/backend/internal/handler/handler.go) — `CreateProject` 自动建默认 Package；`UpdatePackage` 环检测
- [poc-v2/backend/internal/repository/repository.go](file:///f:/code/repos/OHMySysMLV2/poc-v2/backend/internal/repository/repository.go) — 新增 `IsPackageDescendant`
- [poc-v2/backend/internal/handler/packages_views_test.go](file:///f:/code/repos/OHMySysMLV2/poc-v2/backend/internal/handler/packages_views_test.go) — 新增 `TestCreateProjectAutoRootPackage`、`TestPackageMoveCycle`；修正 `TestPackagesCRUD/List` 期望值

### 前端
- [poc-v2/frontend/src/lib/textOps.ts](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/lib/textOps.ts) — 新增 `canNest()`、`insertSnippetIntoElement()`；修正 `detectIndent` 注释
- [poc-v2/frontend/src/canvas/DiagramCanvas.tsx](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/canvas/DiagramCanvas.tsx) — `onPaletteDrop` 加第三个参数 `hoveredNodeId`；hover nodeId 跟踪；视觉反馈 className
- [poc-v2/frontend/src/styles/index.css](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/styles/index.css) — 新增 `rf-palette-drop-ok` / `rf-palette-drop-bad`
- [poc-v2/frontend/src/components/modeling/ModelingPane.tsx](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/components/modeling/ModelingPane.tsx) — `handlePaletteDrop` 三分支
- [poc-v2/frontend/src/components/tree/types.ts](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/components/tree/types.ts) — 新增 `move-package` TreeAction
- [poc-v2/frontend/src/components/tree/TreeRow.tsx](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/components/tree/TreeRow.tsx) — 接受拖拽 props + 高亮样式
- [poc-v2/frontend/src/components/tree/ProjectTree.tsx](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/components/tree/ProjectTree.tsx) — 实现拖拽 handlers
- [poc-v2/frontend/src/components/tree/menuItems.ts](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/components/tree/menuItems.ts) — 新增"移动到顶级"菜单项
- [poc-v2/frontend/src/pages/ProjectDetail.tsx](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/pages/ProjectDetail.tsx) — 新增 `handleMovePackage` + switch case
- 测试：`poc-v2/frontend/src/lib/textOps.test.ts`、`poc-v2/frontend/src/components/tree/menuItems.test.ts`