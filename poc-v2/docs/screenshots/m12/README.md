# M12 自测截图归档（M12.5）

> **状态**：✅ **已归档 11 张**（commit `b3d0966`，tag `m12-screenshot`，2026-09-24）
> Playwright e2e spec: `poc-v2/frontend/e2e/m12-screenshots.spec.ts`

## 已归档清单

### 1. ProjectDetail 三栏 IDE 布局（M12.3 主交付）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 1.1 | `01-three-pane-empty.png` | 打开 `/projects/:pid`，无树选中态：三栏空布局 + 工程根属性 | ✅ |
| 1.2 | `03-package-selected.png` | 选中 Vehicles 包：ModelingPane 加载包内容编辑器 + Palette + 右栏 PackagePropertiesForm | ✅ |
| 1.3 | `04-view-selected.png` | 选中 Structure 视图：ViewModelingPane + 右栏 ViewPropertiesForm (渲染类别/颜色标签/暴露元素) | ✅ |
| 1.4 | `04-canvas-node-selected.png` | 画布选中节点：右栏 ElementFormPanel | ⏳ 未拍（test 暂未包含画布节点选中场景） |

### 2. ProjectTree + ContextMenu（M12.2）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 2.1 | `05-tree-nested-packages.png` | 树递归展示：工程 → Vehicles (展开) → Car → Foundations → Structure | ✅ |
| 2.2 | `06-tree-contextmenu-engineering-root.png` | 右键工程根 → "新建包" 菜单 | ✅ |
| 2.3 | `07-tree-contextmenu-package.png` | 右键 Vehicles 包 → "新建子包/新建视图/重命名/删除" | ✅ |
| 2.4 | `08-tree-contextmenu-view.png` | 右键 Structure 视图 → 视图专属菜单 | ✅ |
| 2.5 | `09-tree-keyboard-navigation.png` | 树键盘 roving tabindex 高亮 | ⏳ 未拍（test 暂未包含键盘导航断言） |

### 3. ModelingToolbar + 双模式建模（M12.3 双模式 drag/text）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 3.1 | `10-toolbar-drag-mode.png` | ModelingToolbar 显示在 `drag` 模式：Palette (结构/行为/需求) | ✅ |
| 3.2 | `11-toolbar-text-mode.png` | 切换到 `text` 模式：全屏 Monaco 编辑器 | ⏳ 未拍（test 中 text 模式选择器名匹配失败） |
| 3.3 | `12-palette-dropdown-open.png` | Palette dropdown 展开：14 种 SysML 元素类型 | ⏳ 未拍（同上） |
| 3.4 | `13-ai-generate-modal.png` | 触发 AI 生成 → AIGenerateModal | ⏳ 未拍（test 暂未触发） |

### 4. 路由合并 + Legacy 跳转（M12.4）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 4.1 | `14-legacy-redirect.png` | `/models/X?projectId=Z` → `<LegacyModelRedirect />` 跳转 `/projects/Z` | ✅ |

### 5. 全局搜索（M12.4）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 5.1 | `15-global-search-mixed.png` | `Ctrl+K` 唤起：搜索 Vehicle 命中 packages + views | ✅ |

### 6. 错误路径 / 边界

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 6.1 | `16-package-name-conflict.png` | 后端 409 `PackageNameConflict`：错误 toast | ⏳ 未拍（test 暂未触发冲突） |
| 6.2 | `17-version-conflict.png` | 乐观锁 409 `VersionConflict`：自动 reload + 重试 | ⏳ 未拍（test 暂未触发） |
| 6.3 | `18-view-exposed-elements.png` | 视图 `expose X::Y` 后，ViewPropertiesForm 暴露元素列表 | ✅ |

## 统计

- ✅ 已归档：**11 / 18**
- ⏳ 未拍：**7**（画布节点选中、键盘导航、text 模式、Palette dropdown、AI 模态、错误路径 ×2）

## 验证证据

- **前端 typecheck** ✅ (`tsc --noEmit` 0 error)
- **前端 vitest** ✅ (133/133 tests pass)
- **Playwright e2e** ✅ (7/7 specs pass)
- **后端 go test** ✅ (`go test ./...` PASS，2026-09-19)

## 重跑命令

```bash
# 后端
cd poc-v2/backend && ./.tools/go/bin/go.exe run ./cmd/server   # :8080

# 前端
cd poc-v2/frontend && npm run dev                              # :3000/:3001

# 截图
cd poc-v2/frontend && BASE_URL=http://localhost:3001 \
  npx playwright test e2e/m12-screenshots --reporter=line
```

输出：`poc-v2/docs/screenshots/m12/*.png`
