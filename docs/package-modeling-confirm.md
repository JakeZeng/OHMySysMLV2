# Package 建模功能点 — 实施计划（v1.5 最终版）

**版本**: 1.5
**日期**: 2026-09-26
**状态**: ✅ 最终方案落地 + 全量测试通过（后端 go test 全 ok，根 183 / frontend 218 / typecheck 干净）+ Docker 重新部署

---

## v1.5 最终澄清（用户原话依据）

> "我的原来意思是，工程同名的工程节点，就是那个特殊的根包节点，而不是需要自动新增一个"
> "删去自动建——project 节点直接是根"

树结构期望：

```
📁 ProjectName   ← project 节点（工程根），保持不变，它本身就是特殊的根包
   ├─ 📦 SubPkg1
   ├─ 📦 SubPkg2
   ├─ 👁 View1
   └─ 🧭 VP1
```

**结论**：不自动创建与项目同名的默认 Package；前端工程树的合成 `project` 节点直接充当 SysML 命名空间根（"特殊的根包"），顶级包/视图/视角的父级即为项目根。

---

## v1.5 回退清单（已全部完成）

| 子项 | 内容 | 状态 |
|---|---|---|
| R1 | 后端 `CreateProject`：删除自动建默认 Package 整段逻辑（含回滚、双审计），恢复为只建项目 + 单条审计 | ✅ |
| R2 | 后端 `DeletePackage`：删除 E_ROOT_PACKAGE_PROTECTED 根包保护逻辑 | ✅ |
| R3 | 前端 `tree.ts`：删除 `findRootPackage` 及所有 rootPkg 特殊处理，树根恢复为合成 `project` 节点（顶级包挂 `''`） | ✅ |
| R4 | 前端 `ProjectTree.tsx`：Context 菜单 `isRootPackage` 恒传 `false`（不再有"特殊根包"概念） | ✅ |
| R5 | 后端测试：删除 `TestCreateProjectAutoRootPackage`、`TestRootPackageProtected`；`TestPackagesCRUD/List` 期望回退为 1 | ✅ |
| R6 | 后端测试：`TestPackageMoveCycle` 跨项目用例改为显式创建 OtherPkg（其他项目不再有默认包可取）；注释去掉"自动建默认包 P0" | ✅ |

## v1.4 → 保留项（不受 v1.5 影响）

| 子项 | 内容 | 状态 |
|---|---|---|
| K1 | 嵌套语义按**目标节点**判定：`nodeKindHasBody` / `canNestIntoBody`（def 类有 body 可嵌，usage 类拒绝 + toast） | ✅ |
| K2 | `insertSnippetIntoElement`：拖到 def 节点 = 嵌入其 body（缩进对齐 + 空 body fallback + 尾随空白裁剪） | ✅ |
| K3 | 拖拽落点三分支（DiagramCanvas hover 检测 + 绿框 `rf-palette-drop-ok` / 红框 `rf-palette-drop-bad`） | ✅ |
| K4 | 树拖拽重排 Package 嵌套（`move-package` action + `handleMovePackage` + "移动到顶级"菜单项） | ✅ |
| K5 | 后端 `UpdatePackage` 环检测（self / descendant / 跨项目，`IsPackageDescendant` 参数顺序已修正） | ✅ |

---

## 1. 用户真实意图（最终版）

| 需求 | 含义 |
|---|---|
| 1. project 节点 = 特殊的根包 | 工程树顶端的 project 节点本身就是根，**不**额外自动建同名 Package；项目下可建多个顶级包 |
| 2. 拖到元素上 = 加嵌套成员 | 拖到 def 类（有 body）→ 嵌到 body；拖到 usage（无 body）→ 拒绝（toast 报错） |
| 3. 树拖拽重排 Package 嵌套 | 树节点可拖动改变 `parent_package_id`（右键"移动到顶级"也可） |

---

## 2. 测试结果（v1.5 最终）

| 测试套件 | 结果 | 状态 |
|---|---|---|
| `poc-v2/backend` go test（go 1.27.1） | 8 packages 全部 ok（含删除/修正后的 handler 测试） | ✅ |
| `poc-v2` 根 vitest | 12 files / 183 passed | ✅ |
| `poc-v2/frontend` vitest | 19 files / 218 passed（含 menuItems 新增 root package(M16) 用例） | ✅ |
| `poc-v2/frontend` typecheck | tsc --noEmit 无错误 | ✅ |

---

## 3. 关键文件变更（v1.5 增量）

### 后端
- [poc-v2/backend/internal/handler/handler.go](file:///f:/code/repos/OHMySysMLV2/poc-v2/backend/internal/handler/handler.go) — 回退 `CreateProject` 自动建包；删除 `DeletePackage` 根包保护（`UpdatePackage` 环检测保留）
- [poc-v2/backend/internal/handler/packages_views_test.go](file:///f:/code/repos/OHMySysMLV2/poc-v2/backend/internal/handler/packages_views_test.go) — 删除 2 个废弃测试；`List` 期望回 1；`TestPackageMoveCycle` 跨项目用例改显式建包

### 前端
- [poc-v2/frontend/src/lib/tree.ts](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/lib/tree.ts) — 删除 rootPkg 特殊处理，恢复合成 `project` 节点为树根
- [poc-v2/frontend/src/components/tree/ProjectTree.tsx](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/components/tree/ProjectTree.tsx) — `menuItemsFor(..., false)`；包拖拽重排 handlers 保留
- [poc-v2/frontend/src/lib/textOps.ts](file:///f:/code/repos/OHMySysMLV2/poc-v2/frontend/src/lib/textOps.ts) — `nodeKindHasBody` / `canNestIntoBody` / `insertSnippetIntoElement`（v1.4 语义，保留）

---

## 4. 部署

| 步骤 | 状态 |
|---|---|
| `docker compose up -d --build`（backend + frontend 重建） | ✅ |
| 健康检查 `/api/v1/health` | ✅ |
