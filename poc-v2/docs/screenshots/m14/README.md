# M14 截图归档（6 张）

> 详细交付与范围见 `poc-v2/docs/m14-summary.md`。
> 回归与修复（M14.1）见 `poc-v2/docs/m14.1-summary.md`。

## 6 张清单

| # | 文件 | 说明 |
|---|------|------|
| 01 | `01-auto-named-package.png` | 工程根右键 → 自动创建 `Package_1`（无 prompt） |
| 02 | `02-auto-named-element-palette.png` | Palette 点击 Port Def → 自动插入 `NewPort_1` |
| 03 | `03-tree-create-element-modal.png` | 树右键 Package_1 → 新建元素 → ElementTypeChooserModal（9 项 / 3 组） |
| 04 | `04-tree-shows-elements.png` | 选中 Sample 包 → 树显示 4 个 partDef 子节点 |
| 05 | `05-click-element-highlights-canvas.png` | 点击树上元素 → 中栏画布高亮同一节点 |
| 06 | `06-connect-auto-from-edge.png` | Palette 拖线提示「自动生成 connect / transition」 |

## 复跑

```bash
# 前置：后端 :8080，前端 :5173
cd poc-v2/frontend
npx playwright test e2e/m14-auto-naming --reporter=line
```
