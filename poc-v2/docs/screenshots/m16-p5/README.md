# M16-P5 截图归档（12 张）

> M16 P5（`f5f8304`） + 浏览器自测（`1643162`）走真实 UI 路径覆盖：expose 到视图、description→doc、元素级 rename / delete、布局持久化。归档见 `poc-v2/docs/m16-summary.md` §「P5 阶段详情（下）：浏览器自测 + 截图归档」。

| # | 文件 | 说明 |
|---|------|------|
| 01 | `01-element-context-menu.png` | 树上 Package 元素右键菜单（含「Expose 到视图…」等） |
| 02 | `02-expose-view-picker.png` | Expose 目标视图 picker，**只列 ViewUsage**（§7.26 硬约束） |
| 03 | `03-expose-applied-in-view.png` | view body 内已写入 `expose VehicleModel::Vehicle;`，view 打开后 `1 resolved` |
| 04 | `04-element-form-description.png` | 元素表单 description 字段 |
| 05 | `05-doc-member-written.png` | 保存后 content 命中 `doc /* … */;` |
| 06 | `06-inline-attribute-edit.png` | 属性行内改名表单 |
| 06b | `06b-attribute-type-updated.png` | 改名 `MassValue` 落库后类型侧 |
| 07 | `07-element-renamed.png` | 树上 `Engine → Powertrain` 选中态 |
| 07b | `07b-rename-synced-in-text.png` | 文本模式编辑器同步重命名 |
| 08 | `08-element-deleted.png` | 删除元素后相邻声明完好（回归缺陷 1+2） |
| 09 | `09-layout-after-drag.png` | 拖动后模型坐标已变（落 localStorage 缓存） |
| 10 | `10-layout-after-reload.png` | 刷新后模型坐标与拖动前一致（后端 layout 持久化生效） |

## 复跑

```bash
# 前置：后端 :8080，前端 :3000（项目 vite.config.ts 的 port）
# 若 3000 被旧 sysmlv2-frontend Docker 容器占着，先 docker stop sysmlv2-frontend
npx playwright test e2e/m16-p5-screenshots --reporter=line
```

## 揪出的真 bug（已修复，详见 m16-summary §143-164）

1. 拖动画布即空白（`DiagramCanvas.tsx`）：render 的 race 把节点清掉
2. 布局恢复与 pipeline 竞态（`modelStore.ts`）：layout 写入与 parse→validate→flow 链条冲突
3. 选中态失效 + 编辑即丢失（`DiagramCanvas.tsx` + parser `nextId` 全局计数器）：重命名或删除触发后选中态被清掉
