# M14 — 自动命名 + 树右键创建元素 + 元素进树（截图归档）

## 6 张截图清单

| # | 文件 | 说明 |
|---|------|------|
| 01 | `01-auto-named-package.png` | 工程根右键 → 自动创建 `Package_1`（无 prompt），toast `已创建包 [Package_1]`，属性面板显示 |
| 02 | `02-auto-named-element-palette.png` | Palette 点击 Port Def → 自动插入 `NewPort_1`（与已有节点去重），toast `已添加 Port Def / Port Def "NewPort_1" 已插入` |
| 03 | `03-tree-create-element-modal.png` | 树右键 Package_1 → 新建元素 → ElementTypeChooserModal（9 项 / 3 组：结构 / 行为 / 需求） |
| 04 | `04-tree-shows-elements.png` | 选中 Sample 包 → 树显示 4 个 partDef 子节点（Vehicle/Car/Engine/Wheel，圆形图标），画布渲染 4 个 PART DEF 节点 |
| 05 | `05-click-element-highlights-canvas.png` | 点击树上元素 → 中栏高亮选中（Vehicle 选中态） |
| 06 | `06-connect-auto-from-edge.png` | FSM 包含 state machine Order（Idle/Running/Done），画布渲染 3 个 state 节点，Palette 底部提示「从节点拖线自动生成 connect / transition」 |

## 复跑

```bash
# 前置：后端 :8080，前端 :3000
cd poc-v2/frontend
npx playwright test e2e/m14-auto-naming --reporter=line
```

输出本目录下的 6 张 PNG。

## 范围

✅ 自动命名（包/视图/元素/Palette 全部） — `lib/naming.ts` + `generateUniqueName`
✅ 树右键 → "新建元素" → 类型选择 → 创建
✅ 元素进树（懒加载：`elementTreeCacheStore` + `usePackageElements`）
✅ 选中元素 → 跳转到该 package 并自动聚焦
✅ transition/connect 由连线自动创建
✅ F2 重命名（保留 prompt — 显式行为）

⏭ 不在本轮范围（→ M15 / M16）：
- Palette 全 30 项扩展、分组、搜索
- Palette 按 subject 过滤（视图/包不同）
- 元素的"双击下钻到子元素"递归建模
- 视图只读 expose 画布

## 测试

```bash
cd poc-v2/frontend
npm run test -- --run
npm run typecheck
```

vitest：175 / 175 ✅
typecheck：clean ✅