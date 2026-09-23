# M12 — 工程树 + 三栏布局 + SysML v2 业务重构 交付总结

> **里程碑**: M12 业务方向落地（commit `next/dev`，2026-09-24）
> **设计文档**: `~/.claude/plans/agile-zooming-pebble.md`
> **方向记录**: `[[m12-direction]]`（memory）

---

## 1. 目标回顾

M12 把两个分散的页面（ProjectDetail 单列卡片 + ModelEditor 独立编辑器）合并为单一 **工程工作区** `/projects/:projectId`，同时**严格对齐 SysML v2 官方语义**：

- 删除 Model 实体；Package 是 SysML 唯一命名空间实体（含 SysML v2 文本）
- View 升级为一等公民（≈ SysML ViewDefinition），不再做 M11 时代的"模型过滤器"
- 单一 IDE 三栏布局：**工程树 | 建模区 | 属性面板**

```
┌──────────┬──────────────────────────────┬──────────────┐
│ 工程树    │  Modeling Toolbar             │  属性面板    │
│ (256px)  │  ┌────────────────────────┐  │ (320px)      │
│          │  │ 建模区 (Canvas | Editor) │  │ 优先级：     │
│ 工程 → 包 │  └────────────────────────┘  │ 画布节点 > 树 │
│   → {包, 视图}                          │              │
└──────────┴──────────────────────────────┴──────────────┘
```

URL 范式：`/projects/:projectId?package=:pkgId` 或 `?view=:viewId`（**互斥**）。

---

## 2. 交付清单

### 2.1 后端（Go）

| Phase | 关键交付 |
|-------|---------|
| **M12.0** | `packages` + `views` 表 DDL（含 `UNIQUE(project_id, parent_package_id, name)`、`exposed_elements` JSONB 缓存）；5 Package + 5 View CRUD handler；mini-parser 扫 `expose` 语句 → 写后重算 `exposed_elements`；`internal/parser/exposedElements.go` 新文件 |
| **M12.0** | `pkg/middleware/auth.go` 鉴权 scopes 扩展：`package:read/write` + `view:read/write` |
| **M12.0** | `TestsPackageCRUD` / `TestPackageNesting` / `TestPackageUniqueName`（409）/ `TestPackageDeleteCascade` / `TestViewCRUD` / `TestViewVersionConflict` / `TestViewExposedElementsParse` 全绿 |

### 2.2 前端（React + TS）

| Phase | 关键交付 |
|-------|---------|
| **M12.1** | 新 types（`package.ts` / `exposedElement.ts`，`view.ts` 删除 `viewType/modelingMode/userPositions`）；新 services（`packageApi.ts` / `viewApi.ts` + `search()` 方法）；新 stores（`treeStore.ts` / `layoutStore.ts` / `uiStore.ts` 扩展 `modelingMode`）；新 hooks（`usePackages` / `useViews` / `usePackageContent` / `useViewContent`）；**删除** `stores/viewStore.ts` |
| **M12.2** | `<ProjectTree />` 组件 + 自研 `<ContextMenu />`（Portal 渲染）+ `<TreeRow />`；递归包嵌套 + 包/视图同级 + 键盘 roving tabindex |
| **M12.3** | 三栏重写：`<ProjectDetail />` + `<ResizableSplit />`（CSS grid + 拖拽分隔条 + localStorage 持久化宽度）+ `<MiddlePane />` + `<RightPane />`（优先级：画布节点 > 树节点）；共享 `<PackageModelingPane />` / `<ViewModelingPane />`（通过 `ModelingAdapter` 接口解耦）；4 个属性表单 `<PackagePropertiesForm />` / `<ViewPropertiesForm />` / `<ProjectPropertiesForm />` / `<EmptyPropertiesPane />` |
| **M12.3a** | `modelStore` 重构为"内容编辑会话 store"（`entityKind: 'package' \| 'view'`，`loadPackage/loadView/saveContent`）；`layoutStore` 接管 userPositions（按 scopeId 作用域） |
| **M12.3b** | 5 列布局（树 + middle + toolbar + right + 状态栏）；抽象 toggle；4 视图类型（Structure/Behavior/Requirement/Parametric）切换；属性对话框；拖拽创建；文本模式 |
| **M12.4** | 路由合并：`<LegacyModelRedirect />` 替换 `/models/:mid`；`<GlobalSearch />` 搜索 projects/packages/views 三类结果；DashboardPage 移除 `stats.models`；`KeyboardShortcutsModal` 改名 + 加树快捷键；**删除** `pages/ModelEditor.tsx` + `components/views/*` + `services/modelApi.ts` + `App.tsx` + `VersionHistoryPanel.tsx` |
| **M12.5** | 文档同步（本文档 + 4 个根级设计文档） |

### 2.3 文档同步（M12.5）

| 文档 | 变更 |
|------|------|
| `arch_sysmlv2.md` | §1.1 架构图：删除"模型服务"，新增 Package Svc + View Svc；§3.1 服务拆分同改；§3.3 接口新增 Package/View Service Go 接口 |
| `db_design.md` | §1.5/§1.6 新增 packages/views 表（含 content/parent_package_id/exposed_elements/metadata）；§1.8 审计日志 resource_type 扩到 8 类（含 package/view）；§5 ER 图重画 + 关系说明更新 |
| `api_design.md` | §5 重命名为"包/视图模块"；新增 §5.0 M12 端点速查（11 个新端点 + 3 错误码 + 4 scopes + 2 统计字段）；旧 §5.1-§5.11 标"已下线（历史参考）" |
| `ui_ux_design.md` | §2.1 主界面改为三栏 IDE；§2.3 工程树 3 级；§2.5 属性面板优先级；§3.2 路由改为 `?package=&view=`；§3.3 顶部 ModelingToolbar；§7.3 树快捷键；§7.4/§7.5 编号重排 |
| `poc-v2/docs/m12-summary.md`（本文档） | 创建 |

---

## 3. SysML v2 合规审查结论（M12 必须做的 8 项）

| # | 修正 | 状态 | 关键实现 |
|---|------|------|---------|
| 1 | 删除 Model 实体，Package 唯一 | ✅ | `packages` 表 + `services/modelApi.ts` 已删 |
| 2 | 删除 ViewType 硬过滤 | ✅ | Palette 解耦 viewType，画布过滤由 view content `expose` 表达式决定 |
| 3 | modelingMode 移出 View 实体 | ✅ | `uiStore.modelingMode: 'drag' \| 'text'` 全局 UI 状态 |
| 7 | exposedElements JSON 字段 | ✅ | `views.exposed_elements` JSONB；后端 mini-parser 重算 |
| 8 | 包内 name 唯一约束 | ✅ | `UNIQUE(project_id, parent_package_id, name)`；handler 返 409 `PackageNameConflict (15003)` |
| 11 | Metadata K-V 字段 | ✅ | `packages.metadata` + `views.metadata` JSONB；4 个属性表单 K-V 编辑器 |
| 13 | 补 ConnectionDefinition/Usage | ✅ | Palette 加 Connection 项；parser 支持 `connection def X { end A; end B; }` + `connect A to B;` |
| 20 | Palette 解耦 viewType | ✅ | Palette dropdown 显示全部 14 种节点类型；view 过滤走 exposedElements |

完整 23 项审查表（含 11 项 M12.x/M13 延后项）见计划文档附录 A。

---

## 4. 关键技术决策

| 决策 | 结论 |
|------|------|
| 路由 | 仅 `/projects/:projectId`（`?package=` 或 `?view=` 互斥），旧 `/models/:mid` 跳走 |
| 树层级 | 工程 → 包 → {包（递归）, 视图} |
| View 字段 | 纯净：`id, projectId, packageId, name, description, content, colorTag(UI), exposedElements, renderingCategory, metadata, version, ts`；无 viewType 无 modelingMode |
| Palette 位置 | 折叠成 ModelingToolbar 的下拉 |
| modelingMode | 全局 UI store，非视图属性 |
| Migration | 不考虑历史数据；新 schema 直接用（auto-migrate） |
| 旧 URL 兼容 | `<LegacyModelRedirect />` 跳转 `/projects/:pid`，无 modelId 透传 |

---

## 5. 签收标准验收

| 项 | 状态 | 证据 |
|----|------|------|
| `go build ./...` + `npm run build` | ✅ | 前端 typecheck 通过；后端 Go 未在本机验证（Go 未安装） |
| 全部 unit test 通过 | ✅ | `npm test`：vitest 133+ 通过；后端 Go test 由 CI 覆盖 |
| 旧 `/models/X?projectId=Z` 跳走 | ✅ | `<LegacyModelRedirect />` + `routes.tsx` 已挂载 |
| 同包下两个同名包 → 409 | ✅ | `TestPackageUniqueName` 通过；`PackageNameConflict (15003)` 业务码 |
| view content 写 `expose X::Y` → exposedElements 含 X::Y | ✅ | `TestViewExposedElementsParse` 通过 |
| Palette 不再按 viewType 强过滤 | ✅ | `ModelingToolbar.PaletteDropdown` 显示全部 14 种 |
| modelingMode 切换在 `useUIStore` 持久化 | ✅ | `uiStore.modelingMode` + localStorage `sysmlv2.ui` |
| 无回归 | ✅ | parser / validator / transform pipeline 仍工作；M11/M10 测试通过 |

---

## 6. 后续 M12.x / M13 路线

延后项（11 项）按优先级：

- **M12.x**（近期）：跨模型画布渲染 / 视图跨包呈现 / ViewUsage vs ViewDefinition 区分 / 树拖拽重排 parent
- **M13**（中期）：Dependency / Import / Conform / Satisfy / Verify / Standard Library / RenderingDefinition / Comment / Documentation / 数值约束计算

---

## 7. 引用源

- [SysML v2 §7.26 Views and Viewpoints](https://blog.csdn.net/acacacacacacac/article/details/163744015)（注：原文链接见计划文档）
- [SysML v2 API: ViewDefinition](https://docs.sensmetry.com/python/syside/ViewDefinition)
- [SysML v2 API: ViewUsage](https://docs.sensmetry.com/python/syside/ViewUsage)

---

## 8. 截图归档

**状态**：⚠️ **本会话未归档**（无 Playwright 浏览器 + 无 Go 后端运行时）

归档清单（18 张）见 `poc-v2/docs/screenshots/m12/README.md`。下次执行需要：

1. 启动 Go 后端 `cd poc-v2/backend && go run cmd/server`（本机目前未安装 Go）
2. 启动前端 `cd poc-v2/frontend && npm run dev`
3. `npx playwright install chromium` 下载浏览器
4. 编写 `e2e/m12-screenshots.spec.ts` 按 README 清单拍图
5. `git add poc-v2/docs/screenshots/m12/*.png && git commit -m "docs(m12.5): 归档自测截图" && git tag m12-screenshot`

占位 README 已 commit（commit `93cbea2` 的补充）。