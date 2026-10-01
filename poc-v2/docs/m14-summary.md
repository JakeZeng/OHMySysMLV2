# M14 — 自动命名 + 树右键创建元素 + 元素进树（懒加载）+ 选中跳画布

> **里程碑**：M14（`next/dev`，2026-09-25）
> **commits**：`3121b0c`（auto-naming helper）· `39768d8`（tree right-click create + elements in tree + click-to-highlight）· `7dcc27b` / `67b0f2d`（tests + e2e）· `76f6b77`（docs）
> **截图归档**：`poc-v2/docs/screenshots/m14/README.md`（6 张）

---

## 1. 目标

- 元素名由系统生成，避免重复 prompt 拖慢节奏
- 在模型树上右键任意 Package 即可弹出「新建元素」菜单，跳过画布
- 模型元素要进树（之前只显示顶层），且支持懒加载
- 树上选元素 → 画布高亮同一节点

## 2. 范围与边界

✅ 自动命名（包/视图/元素/Palette 全部）— `lib/naming.ts` + `generateUniqueName`
✅ 树右键 → "新建元素" → 类型选择 → 创建
✅ 元素进树（懒加载：`elementTreeCacheStore` + `usePackageElements`）
✅ 选中元素 → 跳转到该 package 并自动聚焦
✅ transition / connect 由连线自动创建（Palette 拖线提示）
✅ F2 重命名（保留 prompt —— 显式行为）

⏭ 不在本轮范围（→ M15 / M16 收口）：
- Palette 全 30 项扩展、分组、搜索
- Palette 按 subject 过滤（视图/包不同）
- 元素的"双击下钻到子元素"递归建模
- 视图只读 expose 画布

## 3. 交付明细

| 模块 | 文件 | 说明 |
|---|---|---|
| 自动命名 | `frontend/src/lib/naming.ts` | `generateUniqueName(type, owner, existing)`，按 owner 范围内去重 |
| 树右键菜单 | `frontend/src/components/tree/ElementTypeChooserModal.tsx` | 9 项 / 3 组（结构 / 行为 / 需求） |
| 元素进树 | `frontend/src/stores/elementTreeCacheStore.ts` + `usePackageElements` | 懒加载：只展开才发请求 |
| 选中跳画布 | `frontend/src/canvas/DiagramCanvas.tsx` + store action | 画布 `highlightNode(id)` |
| Palette 拖线 | `frontend/src/components/palette/Palette.tsx` | 从节点拖线自动生成 connect / transition |

## 4. 测试

```bash
cd poc-v2/frontend
npm run test -- --run        # vitest 175/175 ✅
npm run typecheck            # clean ✅
npx playwright test e2e/m14-auto-naming --reporter=line   # 6 张截图
```

