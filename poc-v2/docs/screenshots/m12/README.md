# M12 自测截图归档（M12.5）

> **状态**：⚠️ **本会话未归档**（无 Playwright 浏览器 + 无 Go 后端运行时）
> **作者下次执行**：见下文"如何归档"步骤

## 待归档清单（按 plan 附录 D + M12.3 三栏场景）

### 1. ProjectDetail 三栏 IDE 布局（M12.3 主交付）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 1.1 | `01-three-pane-empty.png` | 打开 `/projects/:pid`，无树选中态：三栏空布局 + 工程根节点属性 | ⏳ 待拍 |
| 1.2 | `02-package-selected.png` | 选中顶层包：ModelingPane 加载包内容编辑器 + ModelingToolbar + 右栏显示 PackagePropertiesForm | ⏳ 待拍 |
| 1.3 | `03-view-selected.png` | 选中视图：ModelingPane 切换到 ViewModelingPane（暴露元素指示器高亮） | ⏳ 待拍 |
| 1.4 | `04-canvas-node-selected.png` | 画布选中节点：右栏自动切到 ElementFormPanel（SysML v2 元素属性） | ⏳ 待拍 |

### 2. ProjectTree + ContextMenu（M12.2）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 2.1 | `05-tree-nested-packages.png` | 树递归展示：工程 → 包 → {子包（递归嵌套）}，展开/折叠 chevron 状态 | ⏳ 待拍 |
| 2.2 | `06-tree-contextmenu-engineering-root.png` | 右键工程根 → 弹出"新建包"菜单 | ⏳ 待拍 |
| 2.3 | `07-tree-contextmenu-package.png` | 右键包 → 弹出"新建子包 / 新建视图 / 重命名 / 删除"菜单 | ⏳ 待拍 |
| 2.4 | `08-tree-contextmenu-view.png` | 右键视图 → 弹出"视图属性 / 重命名 / 复制 / 删除 / 打开"菜单 | ⏳ 待拍 |
| 2.5 | `09-tree-keyboard-navigation.png` | 树节点聚焦态：WAI-ARIA roving tabindex 高亮，键盘 Enter 选中 | ⏳ 待拍 |

### 3. ModelingToolbar + 双模式建模（M12.3 双模式 drag/text）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 3.1 | `10-toolbar-drag-mode.png` | ModelingToolbar 显示在 `drag` 模式：Palette dropdown + Canvas 拖拽 | ⏳ 待拍 |
| 3.2 | `11-toolbar-text-mode.png` | 切换到 `text` 模式：全屏 Monaco 编辑器 | ⏳ 待拍 |
| 3.3 | `12-palette-dropdown-open.png` | Palette 下拉展开：14 种 SysML 元素类型（含 Connection） | ⏳ 待拍 |
| 3.4 | `13-ai-generate-modal.png` | 触发 "AI 生成" → `<AIGenerateModal />` 弹出 | ⏳ 待拍 |

### 4. 路由合并 + Legacy 跳转（M12.4）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 4.1 | `14-legacy-redirect.png` | 粘贴旧 `/models/X?projectId=Z` → `<LegacyModelRedirect />` 跳转到 `/projects/Z` | ⏳ 待拍 |

### 5. 全局搜索（M12.4）

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 5.1 | `15-global-search-mixed.png` | `Ctrl+K` 唤起：搜索结果混合 project / package / view 三类，分类徽章可见 | ⏳ 待拍 |

### 6. 错误路径 / 边界

| 编号 | 文件名 | 内容 | 状态 |
|------|--------|------|------|
| 6.1 | `16-package-name-conflict.png` | 后端 409 `PackageNameConflict`：在同父下尝试创建同名包 → 错误 toast | ⏳ 待拍 |
| 6.2 | `17-version-conflict.png` | 乐观锁 409 `VersionConflict`：A 端保存后 B 端再保存 → 自动 reload + 重试提示 | ⏳ 待拍 |
| 6.3 | `18-view-exposed-elements.png` | 视图 `expose X::Y` 后，右栏 ViewPropertiesForm 暴露元素列表显示引用 | ⏳ 待拍 |

---

## 如何归档（下次执行步骤）

```bash
# 1. 后端启动（依赖 Go 1.21+，本机目前未安装）
cd poc-v2/backend && go run cmd/server
# → http://localhost:8080

# 2. 前端启动
cd poc-v2/frontend && npm run dev
# → http://localhost:3000

# 3. 安装 Playwright 浏览器（一次性 ~200MB）
cd poc-v2/frontend && npx playwright install chromium

# 4. 编写 e2e/m12-screenshots.spec.ts（参考 e2e/smoke.spec.ts 模式）
#    - 登录 → 创建工程 → 树右键新建包 → 写 SysML → 保存 → 截图
#    - 每个编号一个 screenshot() 调用，路径指到 ./docs/screenshots/m12/

# 5. 跑
cd poc-v2/frontend && npx playwright test e2e/m12-screenshots --reporter=line

# 6. 提交
git add poc-v2/docs/screenshots/m12/*.png
git commit -m "docs(m12.5): 归档自测截图（18 张）"
git tag m12-screenshot
```

---

## 占位说明

文件已存在但为空（仅 `README.md`）。下一位执行者按上述步骤补 PNG 后，
`m12-summary.md` 第 8 节的"截图归档于 `poc-v2/docs/screenshots/m12/`"将从占位变实际。