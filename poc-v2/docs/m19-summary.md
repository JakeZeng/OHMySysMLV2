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


