# M19 — 建模交互与数据逻辑重新核定（第一轮）

> 目标（四条硬需求）：
> 1. 必须满足 SysML v2 规范
> 2. 支持文本与可视化无障碍切换
> 3. **树就是文本工程的层级、嵌套结构**
> 4. 视图要完整实现 SysML v2 规范 —— 同一元素在不同视图、同一视图使用逻辑
>
> 本轮定位：**先修「数据逻辑的地基」**。四条需求里有三条（2/3/4）都建立在
> 「模型的层级与归属是唯一真相」这个前提上；地基不修，上层怎么调都是补丁。

---

## 一、审计结论（核心发现）

### 发现 1（地基级）：解析器在「扁平化」时**销毁了元素的归属**

`poc-v2/parser/parser.ts` 的 `flattenNestedMembers` 原本把包内的
`stateMachine` / `activity` / `requirement` / `constraintBlock`
**从 `pkg.members` 里删掉**，只留在 `model.stateMachines` 等顶层数组里。

后果（三条，全部可复现）：

| 后果 | 证据 |
|---|---|
| **树 ≠ 文本层级** —— 包里的状态机在 AST 层面已经是顶层元素，树按 `members` 建树就再也挂不回包下面 | `parser.ts:151-162`（改造前） |
| 限定名丢前缀 —— `P::SM` 退化成 `SM` | `modelToFlow.ts:163`（改造前注释自认「qname 就是短名」） |
| 同一元素在 AST 里有**两处真相**（members 一处、顶层索引一处） | `parser.ts:181-186` + `modelToFlow.ts:163-167` |

注意：视图 / 视角**没有**这个问题（`parser.ts:143-150` 明确 `remaining.push(m)` 保留归属），
只有行为/需求/约束块被删了 —— 说明这更像是**疏忽**而不是设计。

**M19 修复**：提升 = 多一份按 kind 取集合的**索引**，不再搬走成员。
归属保留 → 树的层级、限定名、所有权判定同时恢复正确。

### 发现 2：树面板自己遍历 AST，漏掉了一整类成员

`frontend/src/stores/elementTreeCacheStore.ts` 原来的 `extractElementsFromModel`：

- 只认**隐式根包**的成员 + 包成员 —— 顶层 `state machine` / `activity` /
  `requirement` / `constraint block` **整类掉出树外**；
- 把状态机的 state、活动里的 action **平铺成没有父节点的孤儿**；
- 显式跳过 `view` / `viewpoint` 成员（注释：「由后端 View/Viewpoint 实体节点呈现」）——
  但视图实体是**另一套存储**，用户在包里手写的 `view def V { … }` 在树里根本看不见；
- 同层顺序不是文本顺序（隐式根成员在前，行为元素追加在末尾）。

### 发现 3：同一份 SysML 文本有**两套解析实现**

| 实现 | 位置 | 用途 |
|---|---|---|
| peggy PEG 解析器 | `poc-v2/parser/sysml.pegjs` | 画布、树、校验、编辑 |
| Go 正则解析器 | `poc-v2/backend/internal/parser/viewBody.go` | 视图 expose / render / filter / satisfy 解析 |

Go 侧的 `ComputeExposed`（`viewBody_filter.go:139`）里 filter 求值是
「多 filter AND / 单 filter 退化为不筛」的近似，且有多处 `_ = exp` 之类的空转。
两套实现对同一段文本给出不同结论时，用户看到的就是自相矛盾的模型。

### 发现 4：视图画布只画得出「幽灵方块」

`modelToFlow.ts:411-430`：`exposedExternal` 只带 `qualifiedName` + `kind`，
画出来的是一个没有端口、没有子结构、不可编辑的方块。
即：**expose 的元素在视图里「可见」但不是真的那个元素** —— 与「同一元素在不同视图」
这条需求相距甚远。

---

## 二、本轮落地（可验证）

### 2.1 新增核心模块 `poc-v2/views/hierarchy.ts` —— 统一命名空间层级

**唯一入口**：`buildHierarchy(model)` → 与文本顺序一致的层级树。

- 层级 = AST 的 ownership 链（`members` / `body` / `states` / `actions` / `parameters` / 枚举值）
- 顺序 = 源文本偏移（`location.offset`）
- 成员**不丢**：任何 kind 都不会静默消失
- 同一元素**只出现一次**：顶层索引数组与 `members` 是同一份真相（全局去重表）

配套：`flattenHierarchy` / `findByName` / `qualifiedNameOf`。

### 2.2 新增核心模块 `poc-v2/views/scope.ts` —— 视图作用域（expose 解析的唯一实现）

官方四种粒度（§8.2.2.26）严格实现：

| 路径 | 命中 |
|---|---|
| `P::X` | 仅 X 本身 |
| `P::X::**` | X + 全部后代 |
| `P::*` | P 的直接成员 |
| `P::*::**` | P 的直接成员 + 它们的全部后代 |

- 命中结果**按限定名去重** → 印证「expose 是引用，不是复制」
- 未解析路径单独收集（带诊断原因），不再静默吞掉

### 2.2b 新增核心模块 `poc-v2/views/projection.ts` —— 视图画布 = 模型的投影

**这是需求④「同一元素在不同视图」的核心落地。**

改造前：视图画布对 exposed 元素只画「幽灵方块」（`transform/modelToFlow.ts`
的 `sysmlGhost`）—— 只有名字和来源包标签，**没有端口、没有子结构**，
而且它的身份是 `ghost:<限定名>` 而不是元素本身。

改造后：

```
源包 content ──peggy──► 项目级模型 ──scope──► 作用域限定名
                                              │
视图 content ──peggy──► 视图模型 ──────────────┴──► 投影合成 ──► 画布
```

投影合成把**源 AST 成员本身**（不是副本）放进合成包链，于是 `modelToFlow`
画出来的就是真元素：端口在、子部件在、层级在。

不变式（`tests/viewProjection.test.ts` 11 条钉死）：

- 画布上是 `sysmlPartDef` 真节点，**不是** `sysmlGhost`
- 端口跟着出来（`sysmlPort` 子节点）
- 同一元素在两个视图里 **stableKey 相同** → 身份一致、位置可共享
- 作用域外的元素不会漏进视图
- 连接只在**两端都在作用域内**时投影进来

前端接线（`frontend/src/stores/modelStore.ts`）：

- `loadView` 解析视图的 `reveals` → 只拉「expose 路径首段命中」的源包
  （不做全工程下载）→ `buildProjectModel` 合成 → `resolveProjectScope` 定作用域
- `runPipeline` 通过 `modelTransform` 钩子把作用域投影进视图模型
- `applyElkLayout` 改用 `pipeline.graphModel`（投影后的模型）——
  用 `pipeline.model` 会让 ELK 排出来的图比同步图少一半节点
- 已经被投影的元素**不再画幽灵盒**（否则同一个元素在画布上出现两次：
  一个真节点 + 一个空方块）；投影没覆盖到的仍退化成幽灵盒
- 拉不到源包 / 视图文本还没写完 → 优雅退化成「只画视图自己的成员」

**只读语义**（需求②的「无障碍切换」不能让人改坏源模型）：

- 被投影的元素在节点上标 `data.exposed = true` + `data.sourceQName`
- 属性窗显示横幅「该元素来自源包，在本视图中只读」+ 源限定名，
  并**隐藏改名 / 删除**入口（它们归属源包，得去源包里改）
- 画布上的位置仍可调（位置是**视图本地**的布局数据，按 scopeId=viewId 存）

### 2.3 解析器归属修复 + 画布去重收敛

- `parser/parser.ts`：提升不再搬走成员（保留 `_hoisted` 标记语义不变）
- `transform/modelToFlow.ts`：新增 `dedupeById` —— 同一元素经「命名空间递归」与
  「顶层索引」两条路径各进桶一次时，保留**限定名更完整**的那份

### 2.4 树面板改用统一层级

`frontend/src/stores/elementTreeCacheStore.ts` → 层级来自 `@views/hierarchy`，
不再自己遍历 AST。修好的三处：

1. 顶层 state machine / activity / requirement / constraint block 不再掉出树外
2. 包内状态机的状态挂回状态机下面（state 有父节点了）
3. 同层顺序 = 文本顺序；虚拟「模型根」分组落在它代表的成员的文本位置上

顺带：`TreeRow` 补齐新 kind 的图标（状态机 / 活动 / 视图 / 枚举 / 约束块 …）。

### 2.5 语义变更导致的测试更新（4 条，都是「钉住旧 bug」的断言）

| 测试 | 旧断言 | 新断言 | 为什么变 |
|---|---|---|---|
| `tests/parser.test.ts` 26 | 扁平化后 `view.members` 长度 0 | 长度 1，且成员带 `_hoisted` | 归属保留 |
| `tests/parser.test.ts` 68 | 需求不在 `packages[].members` 里 | 在 | 同上 |
| `tests/edgeSemantics.test.ts` transition | `ownerQName === 'Ignition'` | `'Vehicle::Ignition'` | 限定名恢复前缀 |
| `tests/edgeSemantics.test.ts` flow | `ownerQName === 'Drive'` | `'Vehicle::Drive'` | 同上 |

另外新增：`tests/hierarchy.test.ts`（13 条）、`tests/viewScope.test.ts`（11 条）、
`tests/viewProjection.test.ts`（11 条）、
`frontend/src/stores/modelStore.viewScope.test.ts`（4 条，真实 store 链路）、
`frontend/src/stores/elementTreeCacheStore.test.ts` 新增 6 条 M19 用例 + 改写 1 条
（「content 内的 view 不进元素树」→「进元素树」）。

### 2.6 验证

| 项目 | 结果 |
|---|---|
| 根目录 vitest | **489 passed / 0 failed**（25 个文件） |
| frontend vitest | **793 passed / 0 failed**（34 个文件） |
| Go `go test ./...` | **10 个包全绿** |
| `npm run typecheck` | **clean** |

> 注：`tests/layoutEngine.test.ts` 的「100 节点布局 < 500ms」是墙钟阈值断言，
> 在本机满负载跑全量时偶尔超时（563ms）。已用 `git stash` 隔离确认**改动前后
> 同样会抖**，单跑必绿 —— 是环境问题，不是本轮引入的回归。

---

## 二之二、第二轮：跨作用域误报 + 画布「元素在、端口没了」

第二轮处理两件在 e2e 里实测暴露、且都属于「数据逻辑」的问题。

### 2.7 校验器跨作用域误报（E301 / W303）—— 判定标准改成「全工程找不到」

**症状**（e2e 实测）：视图会话里打开一个 `view ViewA : BaseView { expose SrcModel::Car; }`，
错误面板同时报两条：

```
E301_VIEW_USAGE_NO_DEF  view `ViewA` 引用的 ViewDefinition `BaseView` 在工程内不存在
W303_EXPOSE_NOT_RESOLVED  view `ViewA` 的 `expose` 路径 `SrcModel::Car` 中顶级包 `SrcModel` 在工程内不存在
```

**根因**：校验器只拿到**当前 scope 的一段文本**（一个包 / 一个视图的内容），
而 SysML v2 的命名空间是**工程级**的 —— `BaseView` 是**另一个视图实体**，
`SrcModel` 是**另一个包**。校验器把「当前 scope 看不到」误判成「工程内不存在」。

**修法**（`poc-v2/validator/validator.ts`）：给校验器加一个可选的**工程级作用域**输入。

```ts
export interface ValidationScope {
  viewNames?: readonly string[];      // 工程内所有 view 名
  viewpointNames?: readonly string[]; // 工程内所有 viewpoint 名
  packageNames?: readonly string[];   // 工程内所有包名
  exposeResolution?: {                // expose 的**权威**解析结果
    resolved?: readonly string[];
    unresolved?: readonly { path: string; reason?: string; viewName?: string }[];
  };
}
```

三条原则：

1. **跨 scope 引用能解析就不报** —— E301 / E302 / W303 都改成「本地没有 **且** 工程里也没有」才报；
2. **expose 的解析只有一处实现** —— 校验器不再自己那套「顶级包是否存在」的近似，
   改用 `views/scope.ts`（§8.2.2.26 四种粒度）的权威结果；
3. **缺工程级信息时不断言** —— `packageNames` 缺省 = 「没加载到工程信息」，
   此时**不报** W303。「没加载到」≠「不存在」，这正是要消灭的那类误报。

前端接线：

- `frontend/src/lib/pipeline.ts`：`runPipeline` 新增第 5 参 `validation`
  （scope + `resolveExpose`），把工程级作用域喂给 `validate`；
- `frontend/src/stores/modelStore.ts`：开会话时拉一次工程级名字清单
  （`packageApi.listByProject` + `viewApi.listByProject` + `viewpointApi.listByProject`，
  都是 summary 请求），存成 `validationScope`；expose 的解析交给
  `resolveProjectScope`（`views/projection.ts`）；
- `frontend/src/editor/SysMLEditor.tsx` + `ModelingPane` / `ViewModelingPane` /
  `PackageModelingPane`：编辑器自己的 Monaco marker 也吃同一份作用域 ——
  不然画布不报红了、编辑器里还是一片红。

### 2.8 画布「元素在、端口没了」—— 视口裁剪 + 取景时机

**症状**：视图画布上被 expose 的 part def 是**真节点**（投影生效了），
但它的**端口徽标不见了**。

**根因**（三层，逐层实测确认）：

1. React Flow 的 `fitView` prop 在「节点首次被量到尺寸」时就执行 —— 那一刻画布上的
   坐标还是 pipeline 的**临时 grid 坐标**（80,80 起步），真正的坐标要等 ELK 布局异步算完；
2. 于是视图框住的是临时位置，ELK 落定后节点被挪到视口外（左半截被裁掉）；
3. 端口徽标是 **React Flow 的真子节点**（`parentId`），它**骑在 owner 边框上**
   （有一半探出框外）—— 落在视口外就被 `onlyRenderVisibleElements` 直接**不渲染**。

第 3 条是决定性的：`getNodesInside`（@xyflow/system）用节点的**绝对坐标**做相交判定，
子节点的绝对位置 = owner 绝对位置 + 相对偏移；徽标探出框外的那半截在视口外 → 整块被丢。

**修法**（`frontend/src/canvas/DiagramCanvas.tsx`）：

- **取景时机**：布局落定（`layoutEngine === 'elk'`）后**取景一次**，
  且**只在内容真的被裁到视口外时**才取（内容本来就在视野里就别动用户的视口）；
- **不与手势抢视口**：指针按着、或用户自己平移/缩放过 → 不取景。
  这一条是血的教训：最初的实现是「每次节点集合变化都 fit」，
  结果 M17 的 A / A2 / A4 / A5 四条**单独跑绿、连着跑红** ——
  用户刚按下鼠标、坐标都算好了，画布却自己挪了；
- **视口裁剪按规模启用**：`onlyRenderVisibleElements` 按节点数阈值启用。
  小图全量渲染 —— 徽标探出框外就被丢是**正确性**问题；
  大图才开裁剪换性能（M2/M9 的优化对上百节点的场景才有意义）。

### 2.9 两条 e2e 自身不可靠的断言（测试自己会红）

| 用例 | 问题 | 改法 |
|---|---|---|
| `m17-canvas-interaction` A3 | 取点写死「上边框内侧 10px（**屏幕**坐标）」，而边框带厚 8 **CSS px** —— zoom 放大后屏幕上更厚，取点仍落在带子上，测的其实是「按在带子上」 | 从**边框带自己的盒子**下沿再往下 4px，与 zoom 无关 |
| `m17-canvas-interaction` D2 | ① 默认 30s 预算不够（实测 33s）；②「点保存 + 固定等 2.5s 再回读」在机器忙时读到**旧内容**，误判成「transition 没写进去」 | ① `test.setTimeout(90_000)`；② 回读改为**轮询**到内容出现为止 |

m17 整个 spec 统一 `test.setTimeout(90_000)`（这组用例每条都要开画布、等 ELK、做真实手势，
实测 12~26s，默认 30s 在机器稍忙时就超）。

### 2.10 e2e 改用**无头**浏览器

本机已装 `chromium_headless_shell`（Playwright 1.63），**无头可直接跑**：

```bash
cd poc-v2/frontend && BASE_URL=http://localhost:3002 ./node_modules/.bin/playwright test e2e/<spec>
```

⚠️ **用本地 `node_modules/.bin/playwright`，别用 `npx playwright`**：
本轮踩到 `npx playwright` 判定「本地包没找到」→ 触发安装 → **把项目的
`node_modules` 清空**（前端 344 个包、根目录 79 个包全没了，只能 `npm install` 重装）。

---

## 二之三、第三轮：视图里的 expose 双向化 + 改名跨命名空间传播

需求 2（文本 ↔ 可视化无障碍切换）在**视图侧**还差一半：第二轮把「画布 = 模型投影」
做出来了，但投影是**单向**的 —— 视图文本里增删 expose 子句，画布纹丝不动；
源包里改了名，视图里的引用直接指空。

### 3.1 expose 作用域**按当前文本重算**（原来只在「打开视图」时算一次）

`modelStore.runPipeline` 现在每次都按**当前文本**解析 expose 作用域
（`resolveViewScope`），不再用「打开视图时算好的那一版」。
作用域索引（`buildHierarchy` + `buildScopeIndex`）按 `ProjectModel` 缓存在
`WeakMap` 里 —— 不缓存的话，每敲一个字都要重算整棵工程树的层级。

> ⚠️ 顺带发现**幽灵盒兜底**也得跟着改：兜底清单来自后端那份**已保存时**算出的
> `exposedElements`。用户在视图里删掉一条 expose 之后，后端清单还是旧的 →
> 那个元素被当成「前端没解析出来」→ 又被画回成一个幽灵方块。
> 现在的规则：**前端能解析就是权威**（不在作用域里的一律不画）；
> 只有「有子句解析不出来」（路径找不到 / 源包没拉到）才开兜底。

### 3.2 解析器记录 expose 子句的**文本范围**

`ExposeStatement` 规则现在带 `location.endOffset`（`expose` 到 `;` 之后），
AST 侧新增 `SysMLView.revealClauses: ExposeClause[]`。

为什么不在前端用正则扫 `expose ...;`：那等于又引入**第二套解析实现**
（注释里带 `;`、路径里带 `::` 的边界必然分叉）。本项目 M19 一直在消灭这个。

新增 `poc-v2/views/expose.ts`（纯函数，可单测）：

| 函数 | 作用 |
|---|---|
| `removeExposeClauses` | 按偏移删掉指定的 expose 子句（连同该行缩进与换行） |
| `clausesCovering` | 找出**覆盖**某个元素的子句（官方四种粒度都可能是它） |
| `renameExposePaths` | 把指向被改名对象的子句按**路径段前缀**改写 |

### 3.3 在视图里移除一个被 expose 的元素 = **撤销引用**（不动源包）

§7.26 expose 是**引用不是复制** → 被 expose 的元素归属源命名空间。
所以「在视图里删掉它」的正确语义是**撤销本视图对它的引用**：

- `modelStore.deleteNode` 遇到 `data.exposed` 的节点 → 转 `removeExposedNode`；
- `removeExposedNode` 删掉视图文本里那条 expose 子句 → 作用域重算 → 元素从画布消失；
- 属性窗（`ElementFormPanel`）：被 expose 的元素**只读** + 明确横幅 +
  按钮是「**从视图移除**」而不是「删除节点」；
- 护栏：`renameNode` 遇到 exposed 节点直接拒绝（它的 AST 位置指向源包，
  拿源包偏移去改视图文本会改错地方）。

### 3.4 改名**跨命名空间传播**（源包/源元素改名 → 视图里的 expose 跟着改）

SysML v2 的引用按名解析 → 源包里把 `Car` 改成 `Truck`、或把包 `Vehicle`
改成 `Cars`，视图里那条 `expose Vehicle::Car;` 立刻指空（元素从视图消失 +
多一条校验错误）。MBSE 工具的惯例是**改名带引用一起走**。

- 核心：`views/expose.ts` 的 `renameExposePaths`，按**路径段前缀**匹配 ——
  `Pkg::Car` → `Pkg::Truck`、`Pkg::Car::**` → `Pkg::Truck::**`、
  `Pkg::**` 与 `Other::Car` **不动**（只按短名匹配会误伤同名元素）；
- 接线：`lib/viewRenamePropagation.ts` 扫工程内所有视图 → 只改**确实引用了**
  被改名对象的视图 → 带 `version` + `baseContent` 走乐观锁；
  409（别人同时改了）**跳过并报告**，不覆盖别人的编辑；
- 入口：树右键改包名（`ProjectDetail.handleRename`）、画布/属性窗改元素名
  （`modelStore.renameNode`）。

### 3.5 本轮抓到的 3 个真 bug（都不是需求描述里的，是被新功能照出来的）

1. **ELK 重排冲掉 `exposed` 标记** —— `applyElkLayout` 用 `modelToFlowLayouted`
   **重建**整张节点数组，标记只加在同步路径上 → ELK 一落定，
   「来自源包、只读」的元素就变回可编辑（用户改名改的是源包坐标，视图里毫无反应）。
   症状极隐蔽：**单测绿、e2e 红**（单测在 ELK 落定前就断言了）。
   修法：抽 `markExposedNodes`，**两条路径都标**；单测改成等 `layoutEngine === 'elk'` 再断言。
2. **取景的 rAF 会被节点变化取消 → 取景永远不发生** —— 旧写法是
   「同步置位『已取景』+ rAF 里真正取景」，而 RF 量到节点尺寸立刻回写 nodes →
   effect 重跑 → cleanup 把还没执行的 rAF 取消掉 → 标记已经置位，后面再也不会试。
   症状：m16-p5 的 `Vehicle` 子节点整个 `hidden`（被 `onlyRenderVisibleElements` 裁掉）。
   修法：判定与置位放在**同一个延迟回调**里；节点还没量到尺寸 → 判不了 →
   隔 80ms 重试（上限 12 次），绝不凭假尺寸下结论（`contentInsideViewport` 改成三态）。
3. **幽灵盒兜底把「已删除的 expose」画回来**（见 3.1）。

### 3.6 e2e 自身的问题

- `login.spec.ts` 两条必红：新用户注册后自动登录 → **引导向导**（`fixed inset-0 z-50`
  全屏遮罩）盖住顶栏 → 点「更多」被拦截（`… intercepts pointer events`）。
  其它 spec 都用 `localStorage.onboarding_completed = '1'` 绕开，但这个 spec
  测的正是**新用户第一次登录**的真实路径 → 改成走「用户点右上角 × 关掉向导」。

### 3.7 验证

- 根 vitest **524/524**、frontend vitest **812/812**、Go 全绿、typecheck clean；
- e2e：`m19-tree-view-scope` **7/7**（新增 ③a 移除 expose、④ 改名传播两条）、
  `m17-canvas-interaction` **11/11**、`login` **4/4**；
- 新增单测：`tests/exposeEdit.test.ts`（18）、`viewRenamePropagation.test.ts`（7）、
  `modelStore.viewScope.test.ts`（10，含 ELK 回归）。

---

## 三、遗留（下一轮的落点，按优先级）

### P0 · expose 解析归一（消灭第二套解析器）

`backend/internal/parser/viewBody*.go` 的正则解析与 TS 侧 PEG 解析必须给出同一结论。

后端现状比预想的弱：`viewBody_filter.go:55` 的 `scanPackageMembers` 是**逐行扫描**
（`^\s*(part|port|...) def X`），注释自认「MVP 边界 / P5+ 接入 Go 解析器」——
那个 TODO 一直没做。后果：

- 子包里的元素、part def body 里的成员**都解析不到**（只认包文本里的顶层行）
- `expose P::X::**` 的递归语义靠剥尾部通配符近似，粒度区分不严谨
- filter 求值是「多 filter AND / 单 filter 退化为不筛」的近似

两条路可选：
- 后端改为**消费前端算好的作用域**（解析只在 TS 侧做一次），或
- 把 PEG 语法移植到 Go（成本高，不推荐）

倾向前者。TS 侧已有 `views/scope.ts`（通用语义）+ `views/projection.ts`（项目模型接线），
后端只需要改成「存 + 校验」。

### P1 · 视图与文本的双向同步（需求 2 的视图侧）

- 视图里新增/删除 expose → 回写视图 content
- 视图里编辑 owned 元素 → 回写视图 content
- exposed 元素在视图里**只读**（归属在源包）—— 这条要写进 UI 提示
- 源包改名后，视图里的投影元素要跟着更新（当前 stableKey 用限定名，
  改名等于换身份 —— 需要一个「源元素 id ↔ 稳定身份」的映射）

### P1 · SysML v2 规范符合性收口（需求 1）—— 本轮已把官方写法核对清楚

`views/hierarchy.ts` 的层级现在只覆盖本项目已实现的 kind。规范里还有一批成员
（`OccurrenceUsage` / `FlowUsage` / `SuccessionAsUsage` / `ItemUsage` 的
`referenced` 语义等）需要逐条对照官方 BNF 补齐。

**本轮做的是「核对」（已拿到官方原始材料，不是凭记忆写语法）**：

- 官方示例文本：`https://www.omg.org/cgi-bin/doc?ptc/25-04-31.sysml`
  （OMG SysML v2.0 的 Simple Vehicle Model，73 KB，**官方具体语法**）；
- 官方抽象语法 JSON schema：`https://www.omg.org/spec/SysML/20250201/SysML.json`
  （ptc/25-04-32，3.9 MB）—— 里面确实有 `OccurrenceUsage` / `FlowUsage` /
  `SuccessionAsUsage` / `ItemUsage` / `TransitionUsage` 五个元素。

**从官方示例里逐条核对出来的结论（下一轮照单落地）**：

| 构造 | 官方写法（示例原文） | 本项目现状 | 差距 |
|---|---|---|---|
| FlowUsage | `flow p1.torque to p2.torque;` / `flow of Fuel from fuelOutPort.fuel to fuelInPort.fuel;` | `FlowStatement` 只认 `Identifier` | 端点是**带点路径**（`a.b.c`）→ 官方例子**整篇解析失败**；且缺 `of <Type> from …` 形式 |
| OccurrenceUsage | `occurrence CruiseControl1{ … }`（带 body）/ `occurrence logicalOccurrences [*] nonunique;` | **完全没有** | 要支持 body + 多重性 + `nonunique` |
| SuccessionAsUsage | `first vehicle.doorClosed then driver.driverReady;` | **完全没有** | 官方关键字是 **`first … then …`**（不是 `succession … to …`） |
| TransitionUsage | `transition initial then off;` | `transition A to B;` | 官方用 **`then`**；`to` 是本项目历史方言 → **两个都要接受**（旧内容不能因此解析失败） |
| 事件里的 occurrence | `event occurrence setSpeedReceived;` | 无 | 事件用法带 `occurrence` 前缀 |

⚠️ **不要凭记忆补语法** —— 上一条记录就是本项目 M16 把自造方言
（`stakeholder:` / `concern:`）清掉的原因。下一轮落地时，
**把官方示例文件 `ptc/25-04-31.sysml` 直接当解析器的回归 fixture**：
「能不能整篇解析官方示例」比「能不能解析几条自己写的用例」有说服力得多。

### P2 · e2e 覆盖

`e2e/` 现有 13 个 spec。本轮改动影响树的结构与视图画布，需要补两条：

1. 「树 == 文本层级」：包内状态机在树上挂在包下面、状态挂在状态机下面
2. 「同一元素在不同视图」：视图 expose 一个 part def，画布上出现带端口的真节点，
   且两个视图里的 stableKey 一致

> ✅ 第三轮已补：`e2e/m19-tree-view-scope.spec.ts` 现在 **7/7** ——
> ①a/①b/①c（树 == 文本层级）、②a/②b（同一元素在不同视图）、
> ③a（视图里移除 expose = 撤销引用）、④（源包改名 → expose 路径跟着改）。

---

## 二之四、第四轮：需求①规范收口 + 需求②最后一条 + 后端 expose 归一

### 4.1 需求① —— 官方参考模型「整篇解析通过」

依据仍是 OMG 官方 `ptc/25-04-31.sysml`（Simple Vehicle Model，1580 行）。
这轮把官方模型里此前解析不了的构造**逐条补进 `sysml.pegjs`**，
最终**整篇 1580 行一次解析通过**（每条语法在 grammar 里带官方行号注释）。

新增/修正的官方构造（节选）：

| 官方写法 | 官方行号 | 说明 |
|---|---|---|
| `action x:T { in item …; }` | 726 | action usage 带类型 + 体 |
| `action x send p via q { … }` | 755 | send action |
| `action x accept p:T via q;` | 758 | accept action |
| `perform action x { … }` | 754 | perform 带体 |
| `message of p:T from a to b;` | 781 | message usage 双形态 |
| `event occurrence x;` / `event x.y;` | 778 / 829 | event occurrence / 点路径 |
| `then action x { … }` / `then event x.y;` | 1230 / 841 | succession 的 then 分支 |
| `first start;` / `then fork f1;` | 1385 / 1420 | succession |
| `join j1;` | 1409 | join / fork |
| `part x:>T = path { … }` | 1472 | part 默认值指向实例 |
| `variation part def X:>T { variant part …; }` | 1484 | variation |
| `individual a:T { timeslice … { snapshot … } }` | 1254 | individual |
| `port :>>p:T { port q :>> q [5]; }` | 943 | port 重定义 + 嵌套 |
| `connect [1] a ::> b to [1] c ::> d;` | 968 | 命名空间端点 |
| `#derivation connection { end #a ::> x; }` | 918 | connection def |
| `attribute def X :> Y { attribute w[1..*] { … } }` | 1049 | def 带体 |
| `@Rationale about p::q{ explanation = …; }` | 1121 | metadata about |
| `concern def X { doc … stakeholder s:T; }` | 1549 | concern |
| `view def X:>Y { filter @SysML::PartUsage; }` | 1563 | view 特化 + filter |
| `allocate a to b { allocate c.d to e.f; }` | 507 | allocation 嵌套 |
| `analysis a { objective o { require r; } return attribute x:T=v; }` | 1093 | analysis |
| `calc def X { in a:T; return eval:Real; }` | 1149 | calc |
| `dependency from a to b;` / `#refinement dependency a to b::c;` | 863 / 937 | dependency |
| `verification v { verify r { … } }` | 1219 | verification |
| `requirement <'1'> r:T { subject x; }` | 867 | requirement usage |

**三个必须记住的 PEG 坑**（都是这轮真踩到的）：

1. `!"def"` 是**前缀匹配** → 误杀合法标识符 `defX`（`action defX;` / `interface defX;`
   全挂）。必须写成 `!("def" !IdentifierChar)`（本轮引入 `NotDefKeyword` /
   `NotDefLikeName`，替换 20 条 usage 规则的 `def` 守卫）。
2. **有序选择不跨分支回溯** —— `A / B` 里 A 成功即锁定。需要分支变体时，
   要么「同一条规则 + 可选子句」（ActionUsage 的 send/accept/via），
   要么把特化形态排在前面（`VariantPartUsage` 必须在 `VariantDefinition` 前）。
3. `(_ A / B)` 是「**选择**」不是「空白 + 二选一」—— 成员列表要写 `(_ (A / B))`。
   写错的后果是「体里只能有一个成员，且成员值变 `undefined`」（本轮在
   `AttributeUsageBody` 上真踩到）。

**回归固化**：`poc-v2/tests/officialSyntax.test.ts` 从 28 条扩到 **59 条**
（第 29 条起是本轮新增），每条逐字抄自官方模型并标行号。

### 4.2 需求②最后一条 —— 视图内编辑 owned 元素 → 回写视图 content

一做就抓出**两个真 bug**（都不是需求描述里的，是被这条需求照出来的）：

1. **`transform/textEdit.ts` 的 `collectMembers` 把视图成员当「包」递归**
   （`collectFromPackage(m)`）—— 成员是**元素**（有 kind / name / body），
   没有 `.members` 字段 → `for (const m of pkg.members)` 抛
   `pkg.members is not iterable` → **视图里一改名/一删除就整页崩**。
   包会话却完全正常（包走 `model.packages`，视图成员在 `model.views[].members`）。
   修法：抽出 `collectMember`，包成员与视图成员共用（两者都是 Namespace 成员）。
2. **`findBlockRange` 对「无体声明」按整行删** —— 一行写着
   `view V { expose Vehicle::Car; part def LocalWidget; }` 时，
   删掉 owned 元素会**把整个视图连同 expose 子句一起抹掉**（实测 content 变空串）。
   修法：按「语句起点（向前扫到 `;` / `{` / `}`）→ 语句终点（有体配平括号、
   无体找 `;`）」定位，只删那一条声明。

覆盖：`tests/textEdit.test.ts`（transform 层 3 条）+
`frontend/src/stores/modelStore.viewScope.test.ts`（store 层 3 条）。

### 4.3 后端 expose 解析归一

**权威实现是前端 TS PEG**（`views/scope.ts`）；后端 `viewBody_filter.go`
的词法扫描降级为**兜底**（脚本调用 / 老客户端）。

- `handler.CreateView`：客户端送了 `exposedElements` 就**直接用**，
  **不再跑** `ComputeExposed`（之前虽然最终值会被覆盖，但白跑一遍，
  且中间态与前端不一致 → 树上「⚠ 未解析」徽章与画布自相矛盾）。
- legacy 扫描器 `scanPackageMembers` 升级成**命名空间栈 + 花括号深度**版本：
  子包成员（`Pkg::Sub::Wheel`）与定义体成员（`Pkg::Vehicle::engine`）
  现在也扫得到；花括号闭合后正确出栈（`Pkg::Roof` 不会被挂到已闭合的子包下）。
  ⚠️ 坑：包文本本身是 `package <包名> { … }`，**最外层**的 package 声明
  不能再拼一次名字（否则扫出 `Pkg::Pkg::Vehicle` 双前缀）。

### 4.4 本轮顺带修正的一条 e2e 断言

`m17-s5-s8-syntax` 的「拖不允许的元素到 part def → 矩阵拒绝」原本拖的是
`state`。按官方第 456 行（包级 `state failureModes[*] nonunique;`），
`state`（StateUsage）是合法 usage，**放得进 part def** → 矩阵放行才是对的，
放行之后才撞上「目标 def 没有 body」那道另一道守卫。改成拖
`transition`（状态机专属成员，矩阵仍然拒绝），断言与提示文案不变。

### 4.5 验证

- 根 vitest **587/587**、frontend vitest **816/816**、Go 全绿、typecheck clean；
- e2e 全量 **97/97**（13 spec）。

---

## 二之五、第五轮：画布补齐「体成员」→ 文本 ↔ 可视化真正等价

### 5.1 发现：官方模型能解析了，但画布几乎是空的

需求①让官方参考模型（1580 行）**整篇解析通过**之后，逐条核对「这个元素在
画布上看得见吗」，发现一个此前一直被忽略的事实：

`transform/modelToFlow.ts` 只画**命名空间层**的元素（package / view 的成员）
+ 端口徽标。**定义体 / 用法体里的成员一个都不画**：

```sysml
part def Vehicle {
  part engine : Engine;     ← 画布上看不见
  attribute mass : Real;    ← 看不见（只在节点上显示数量徽标）
  action generateTorque;    ← 看不见
  @Safety{isMandatory = true;}  ← 看不见
  variant part auto : Transmission;  ← 看不见
  individual a : Road { … }         ← 看不见
  event occurrence doorClosed;       ← 看不见
}
```

官方模型里绝大部分元素都写在**体**里 —— 也就是说：解析器认识它们，
树（`views/hierarchy.ts` 泛化遍历）也显示它们，**只有画布看不见**。
需求②「文本与可视化无障碍切换」在这一半元素上是断的。

### 5.2 做法

- `transform/modelToFlow.ts` 新增 `collectBodyMembers`：递归走 `body`，
  把体成员画出来（part/port/structure def、part/item/reference usage、
  状态机、活动、需求、约束块，以及官方新增的那批 kind）。
- 官方新增的那批 kind 走**通用节点** `sysmlUsage`：灰色卡片 + `«kind»` 标题，
  `data.kind` 带真实 kind → 属性窗 / 树 / 校验器都能按 kind 识别。
  属性窗配一份 `USAGE_SCHEMA`（只有「名字 + 类型」），避免套用 part def 的
  「属性」段（那会让人以为能给 metadata 用法加属性）。
- 解析器补 `AnalysisUsage` / `VerificationUsage` / `RequirementUsage` 到
  **定义体**成员表 —— SysML v2 里 Usage 可以被 Definition 拥有。
  ⚠️ 顺序坑：必须排在 `analysis case/def` 形态之后，否则 `case` 会被当名字吃掉。

### 5.3 关键决策：体成员摆顶层，不做 owner 的子节点

第一版把体成员挂成 owner 的子节点（`parentId`），两个硬伤：

1. 零件定义在画布上是**卡片**（200×80），体成员也是一张 200×80 的卡片 →
   子卡片整个盖住父卡片；
2. ELK 会把 owner 的子节点（端口徽标 + 体成员图元）一起参与布局，
   端口的相对坐标跟着变 → 打破「同一 owner 的两个端口纵向排开」这条既有
   不变量（`tests/layoutEngine.test.ts` 第 7 条当场变红）。

所以体成员与命名空间成员**一样摆顶层**（画布是「结构视图」，本来就不画嵌套；
层级由**树**表达 —— 需求③）。层级信息改由 **stableKey 的 owner 路径**承载：

```
partUsage:P::Vehicle::engine
timesliceUsage:P::V::a::t0
```

这样身份仍然唯一、可反查回 owner，且不破坏端口布局。

### 5.4 画什么 / 不画什么

| 成员 | 画布表现 | 理由 |
|---|---|---|
| part / port / structure def、part / item / reference usage | 节点 | 结构元素 |
| 状态机、活动、需求、约束块 | 节点（容器） | 容器语义 |
| 官方新增 kind（metadata / variant / individual / analysis / event / message / join / objective …） | `sysmlUsage` 通用节点 | 语义各异，呈现诉求相同 |
| `portUsage` | owner 边框上的**徽标** | 既有机制（M17） |
| `attributeUsage` | 节点上的**数量徽标** | 画成节点会把画布塞满小方块 |
| `connection` / `allocation` | **边** | 它们是边不是节点 |
| `controlFlow` / `successionAsUsage` / `satisfy` | **边**（语句） | 同上（但它们的**体**里可能有元素 → 体仍然遍历） |
| `doc` / `import` / `alias` / 注释 | 不画 | 不是元素 |
| 无名元素（`constraint { … }`） | 不画 | 没有名字 → 无法被选中 / 定位 |

### 5.5 「藏在深处」的元素

官方模型里有一批元素不在命名空间层，而在**更深的容器**里。漏掉任何一层，
画布上就少一批元素（需求②的等价性再次断裂）：

| 位置 | 官方写法 | 例子 |
|---|---|---|
| 端口体 | `port p { event occurrence e; }` | 12 个 event occurrence |
| 语句体 | `then action a { action b; }` | 6 个 action usage |
| 语句体 | `satisfy R by X { requirement q : Q; }` | 3 个 requirement usage |
| 需求体 | `requirement def R { requirement q : Q; }` | 5 个 requirement usage |
| exhibit state | `exhibit state S { state a { state b; } }` | 24 个状态（**嵌套在 `nested.states`**，不在 `body`） |
| 包级 | `state failureModes[*] nonunique;` | 官方第 456 行的命名空间层状态用法 |

### 5.6 官方模型的覆盖核对

拿官方 1580 行模型做「AST 元素 vs 画布节点」逐 kind 核对（临时探针，已删）：

- **有名字的元素几乎全部上画布**（partUsage 98/98、actionUsage 27/27、
  eventOccurrence 14/14、requirementUsage 13/13、metadataUsage 11/11、
  variantUsage 5/5、stateDef 17/17 …）；
- 剩下的差值都是**有意不画**的：属性（208，走数量徽标）、端口（84，走边框徽标）、
  无名约束块（8）、语句（transition / subject / bind）与端点（interfaceEnd）。

### 5.7 回归

- 新增 `poc-v2/tests/canvasCoverage.test.ts`（**17 条**）：体成员上画布、
  stableKey 带 owner 路径、嵌套定义、属性只做徽标、端口机制不变、
  官方新增 kind（metadata / variant / individual+timeslice+snapshot /
  event / message / action / occurrence / analysis+objective）都画得出来，
  以及「藏在深处」的六种位置。
- 根 vitest **610/610**、frontend vitest **816/816**、Go 全绿、typecheck clean。

## 二之六、第五轮 b：画布等价性的 e2e 收口（抓到 1 个真 bug + 3 个夹具坑）

第五轮把「体成员」画上画布之后，画布上的节点数量、位置、密度全变了 ——
于是 e2e 里几个**原本绿**的用例红了起来。逐条查下去，发现其中一条红的是
**产品坏了**，另外几条红的是**夹具跟新画布对不上**。

### 6.1 🔴 真 bug：「聚焦元素」把整个模型挤出视口

**现象**（m17 的 A5 用例）：画布变成 `transform: translate(298px, 204px) scale(2)`，
4 个节点只露出 1 个，`Wheel` 节点被挤到视口外 → 从它的边框带拖不出连线
（`connect-preview` 根本没出现）。

**根因**：`DiagramCanvas` 里三处「聚焦」都用了
`instance.fitView({ nodes: [目标节点], duration: 500, padding: 0.5 })`。
RF 的 `fitView` 对**单个**节点会把它放到视口中央，并**放到能放的最大缩放**
（`maxZoom` 默认 2）。一张 169×60 的卡片在 876×630 的画布里 → 直接 2 倍 →
其余节点全部被挤出视口。

换个说法：用户点一下工程树里的元素，画布就「只剩那一个卡片」。

**修法**：新增 `focusNodeInView(inst, nodeId, viewW, viewH)`，把语义改成：

> **聚焦 = 居中 + 高亮，不改缩放。**
> 节点已经在视野里 → 完全不动视口（用户的视角归用户管）；
> 节点在视野外 → `setCenter(目标中心, { zoom: 当前缩放 })`。

三处调用点（`applyPendingSelect` / `focusNode` / `focusNodeByName`）统一改用它。

**顺带修**：`focusNodeByName` 用的是 `useImperativeHandle(ref, …, [])` 闭包里
**首帧那份 nodes**（通常是空数组）→ 永远 `return false`。改成读 RF 实时 store
（`instance.getNodes()`）。

### 6.2 夹具坑①：按名字取节点必须按**节点类型**消歧

Playwright 的 `filter({ hasText })` 是**大小写不敏感**的子串匹配。画布上同时存在：

| 文本 | 节点类型 | 来源 |
|---|---|---|
| `«part def» Engine` | `sysmlPartDef` | `part def Engine;` |
| `«part» : Engine` / `engine` | `sysmlPartUsage` | `part engine : Engine;`（体成员） |

两者都含 "engine"，`.first()` 取到哪个纯看 DOM 顺序 → 用例红在跟它要验的东西
无关的地方（本轮 A4 就这么红的）。改用节点类型 class 过滤：

```ts
page.locator('.react-flow__node-sysmlPartDef').filter({ hasText: 'Engine' })
```

### 6.3 夹具坑②：空白点不能写死比例坐标

原来 `blankPoint()` 固定取 pane 的 (28%, 82%)。新增画布节点后那块位置被节点占了
→ 按下去变成「拖某个节点」而不是「拖空白」→ 平移用例红在无关的地方。

改成：扫一圈网格，用 `elementFromPoint` **自校验**（命中的元素不在任何
`.react-flow__node` / `.react-flow__controls` / `.react-flow__minimap` /
`.react-flow__panel` 里才算数），命中不了就抛错 —— 让用例红在真正的意图上。

另外：**平移之后必须重新取一次空白点** —— 内容挪了，原来那块屏幕坐标可能
已经压在某个节点上。

### 6.4 夹具坑③：RF 的 `autoPanOnSelection`（产品特性，别当 bug 修）

React Flow 默认开启 `autoPanOnSelection`：**框选矩形拖到画布边缘 40px 以内，
画布会自动平移**（`@xyflow/system` 的 `calcAutoPan`：越靠近边缘速度越快，
每帧最多 15px）。

本轮实测：空白点选在 88% 高度处，拖 80px 正好越过下边缘 → 触发自动平移 →
「不按空格拖空白不产生平移」那条用例红在一个**产品特性**上（平移量 336px）。

**结论**：这是正常交互（框选到边缘自动滚动画布，Figma 也这样），改产品不合适；
改夹具 —— 空白点必须离边缘留出「拖拽距离 + 40px」的余量。

### 6.5 顺带：m16-p5 的时间预算

m16-p5 整组用例吃全局 30s 预算，实测单条 26~40s（要开画布、等 ELK、
拖节点、刷新再回读布局）→ 全量连跑随机红。给该 describe 加
`test.setTimeout(90_000)`（与 m17 一致）。

### 6.6 验证

- m17（11 条）+ m18（8 条）**19/19 全绿**；
- 全量 e2e 见本轮提交记录。

## 二之七、第六轮：需求①规范收口 + 需求②「关系在画布上可见」

第五轮把「体成员」画上画布之后，画布上有了元素，但**没有关系** ——
官方参考模型在画布上是 **0 条边**。这一轮把两条线一起收掉：
官方元类名对齐（需求①），以及关系可见（需求②）。

### 7.1 需求①规范收口：`ControlFlow` 不是官方元类

拿官方 JSON Schema（`ptc/25-04-32`，本机 `sysml-schema.json`）逐字查：

```
ControlFlow 出现次数: 0
"referenced" 出现次数: 0
定义里只有: Flow / FlowUsage / FlowDefinition / FlowEnd
```

两条结论：

| 本项目原状态 | 官方事实 | 处理 |
|---|---|---|
| `kind: 'controlFlow'`（`flow` 语句一律落成它） | 官方**没有** `ControlFlow` 元类 | 统一改成官方 `flowUsage` |
| 遗留项「`ItemUsage.referenced`」 | schema 里**没有** `referenced` 属性（官方用 `~` 引用标记） | **关闭这条遗留**，不要实现 |

`flow` 在官方模型里有三种上下文（part 体 / interface 体 / action 体），
**都是同一个元类** `FlowUsage` —— 所以不需要按上下文分流，统一即可。

改动面：`ast/model.ts`（`ControlFlow` 接口退役 → `FlowUsage`）、
`parser/sysml.pegjs`（`kind: 'flowUsage'`）、`transform/textEdit.ts`、
`frontend/src/components/tree/TreeRow.tsx`（图标键）、
`tests/officialSyntax.test.ts`（断言）。

### 7.2 🔴 真 bug（解析层）：限定名被截成第 4 个字符

```pegjs
QualifiedNamePart
  = head:Identifier tail:(_ "::" _ n:Identifier { return n; })*
    { return [head, ...tail.map(t => t[3])].join('::'); }   // ← 这里
```

`tail` 的元素是**动作的返回值**（标识符字符串），不是匹配数组 ——
`tail.map(t => t[3])` 取的是**字符串的第 4 个字符**：

| 官方写法 | 改造后 | 原因 |
|---|---|---|
| `ActionTree::providePower` | `ActionTree::v` | `providePower[3] === 'v'` |
| `ActionTree::performSelfTest` | `ActionTree::f` | `performSelfTest[3] === 'f'` |
| `ActionTree::applyParkingBrake` | `ActionTree::l` | `applyParkingBrake[3] === 'l'` |
| `ActionTree::senseTemperature` | `ActionTree::s` | `senseTemperature[3] === 's'` |

后果：官方模型里 4 个 `perform ActionTree::…` 的名字全错 →
限定名查找、端点解析全命中不了。

修法：`[head, ...tail].join('::')`（tail 本身就是字符串数组）。

### 7.3 需求②的断点：官方模型画布上 0 条边

三个独立原因，缺一不可：

1. **收集层**：`collectMembers` 只走**包级成员**（`ns.members`），
   定义体里的 connect / flow / succession **一条都没被收集** ——
   而官方模型里绝大多数 connect 都写在 part def 体里（第 636 / 699 / 707 行）。
2. **解析层**：端点解析只认**全局短名**（`nameToPartId`），
   而官方端点是**相对宿主的路径**：
   `connect differential.leftDiffPort to rearAxle.leftHalfAxle.leftAxleToDiffPort;`。
3. **类型层**：usage 的端口来自**类型的定义** ——
   `part starterMotor : StarterMotor;`（第 644 行）里的 `starterMotor.gearPort`
   指的是 `StarterMotor` **定义体里**的端口，usage 自己体里根本没有端口。

### 7.4 做法：层级索引 + 逐层向外解析

`transform/modelToFlow.ts` 新增 `BuildIndex`：

| 表 | 用途 |
|---|---|
| 宿主 → 直接成员 | 端点路径逐段下钻 |
| 宿主 → 端口 | `part.port` 的第二段 |
| 限定名 → 节点 | `Pkg::Part` 绝对引用 |
| 节点 → 类型名 | 端口的**类型继承** |
| 关系桶 | 定义体里收集到的 connect / flow / succession / allocate |

端点解析按官方 §6.4 **逐层向外**：

```
① 逐层向外下钻：usage scope → 外层 scope → …
   （官方两种写法都要支持：
     `part vehicle_b { part differential; connect differential.leftDiffPort … }`  ← 第一层
     `interface X { connect engine.drivePwrPort … }`                       ← 第二层，宿主 part def 里的）
② 限定名（精确 → 后缀匹配，支持相对限定名 `ActionTree::providePower`）
③ 短名兜底（先 part，再端口）
```

端口查找**支持多级类型继承**（usage → usage → definition）。

关系语句统一画成边，用 `data.semantics.kind` 区分
（`connection` 蓝 / `flowUsage` 青 / `successionAsUsage` 紫 / `allocation` 绿虚线）。

### 7.5 顺带的画布补齐

- **体成员的端口徽标**上画布（官方模型徽标数 62 → **80**）；
- **端口里的嵌套端口**（官方第 571 行 `port x { port y; }`）也画 ——
  否则第 334 行的 connect 端点找不到；
- **有名字的 flowUsage** 是官方 usage（命名空间成员）→ **画成节点**；
  无名的不画（无名 flow 不是元素）。

### 7.6 能力边界（明确记录，不是 bug）

端点是**特性**的流画不出边 —— 端口内特性 / action 的 in-out 参数 / 属性
在本产品里用**数量徽标**表达，**不是画布节点**。

官方模型 69 条关系（21 connection + 8 flow + 33 succession + 7 allocation）里，
**28 条**能画成边，剩下 41 条的端点全部是特性级。

要再往上走，需要把「特性」也建成节点（官方 §7.5 的 Feature 层级），
那是下一轮的「特性建模」专题。

### 7.7 回归

- 新增 `poc-v2/tests/relationVisibility.test.ts`（**12 条**）：官方模型有边、
  定义体里的四种关系都画成边、端点逐层向外解析、端口类型继承（单级/多级）、
  `flow` 的 kind 是官方 `flowUsage`、有名字的 flowUsage 上画布、限定名不被截断。
- `tests/officialSyntax.test.ts` 加第 **28b** 条：`flow` 的 kind 必须是官方
  `FlowUsage`，且**不得**出现 `controlFlow`。
- 根 vitest **616/616**（30 文件）、frontend **816/816**、Go 全绿、typecheck clean。





