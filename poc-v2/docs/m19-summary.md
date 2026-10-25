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

## 二之八、第七轮：特性建模 + 后端 expose 归一 + 协作面板入口

上一轮把「端点是特性的流画不出边」记成了**能力边界**。本轮把它顶掉。

### 8.1 特性建模：端口内特性 / action 参数

官方 SysML v2 里，**端口内特性**与 **action 参数**都是 **Feature**：

```sysml
port def DrivePwrPort {
  attribute torque : Torque;     // ← 端口内特性
}
action def Weigh {
  in  massMeasured : Mass;       // ← action 参数
  out verdict : Boolean;
}
```

它们由端口 / 动作**拥有**，不是命名空间成员，但**关系端点会指向它们**：

| 官方行 | 语句 | 端点形态 |
|---|---|---|
| 316 | `flow p1.torque to p2.torque;` | interface 端点 + 端口内特性 |
| 321 | `flow of Fuel from fuelOutPort.fuel to fuelInPort.fuel;` | 端口 + 端口内特性 |
| 737 | `flow generateToAmplify from generateTorque.engineTorque to amplifyTorque.engineTorque;` | 动作 + action 参数 |
| 759 | `flow of IgnitionCmd from trigger1.ignitionCmd to startEngine.ignitionCmd;` | 动作 + 载荷特性 |
| 1234 | `flow from weighVehicle.massMeasured to evaluatePassFail.massMeasured;` | 动作 + action 参数 |

改造前属性一律走**数量徽标** → 这类端点**永远解析不到** → 关系画不出来。

### 8.2 AST 契约补齐（之前不诚实）

- `ast/model.ts` 的 `PortUsage` **没有 `body` 字段**，而解析器
  （`sysml.pegjs` 的 `PortUsage` 规则）一直在产出 `body: body || []`
  → 端口里写的特性在**类型层面不存在**，下游只能 `as any` 硬转。
- `AttributeUsage` 没有 `direction`（`in` / `out` / `inout`），而解析器的
  `dirAttr()` 一直在产出。

本轮两个字段都补上。

### 8.3 画布与索引

- 新节点类型 **`sysmlAttributeUsage`**：靛蓝窄卡（120px vs 结构元素 200px），
  标题行标方向（`→` / `←` / `↔`），`data.featureOf` = 宿主限定名。
- `transform/modelToFlow.ts`：
  - `FEATURE_OWNER_KINDS` = { portDef, portUsage, actionDefinition,
    actionUsage, sendActionUsage, acceptActionUsage, performUsage }；
  - `registerFeature` / `lookupFeature`（**含类型继承**，最多 4 层）；
  - `BuildIndex.nodeFeatures`；
  - `resolveEndpointNode` 的逐段下钻增加「特性」一档
    （成员 → 端口 → 特性）。

### 8.4 画哪些、不画哪些（有意的范围决定）

| 宿主的特性 | 画布 | 理由 |
|---|---|---|
| 端口内特性（port def / port usage） | ✅ 特性节点 | 关系的端点（官方 321 / 316 行） |
| action 参数（action def / action usage / send / accept / perform） | ✅ 特性节点 | 关系的端点（官方 737 / 759 / 1234 行） |
| part def / part usage 体里的普通属性 | ❌ 只走**数量徽标** | 官方模型里 part 侧属性 60+ 个，全画会把画布塞满；且大多不是关系端点 |

这条规则由 `tests/featureVisibility.test.ts` 的单测钉死（part 侧属性**不得**
出现在画布上，但 `attrCount` 徽标必须在）。

### 8.5 顺带修的三处「断链」

1. **端口徽标的类型没进索引** → `collectPortNodes` 现在记 `nodeTypeRef`，
   端口的特性才能从**类型的定义**继承（官方第 315~316 行）。
2. **`then action X { … }`（官方第 1230 行）** 解析后只有 `target` + `body`，
   动作本身没有 AST 节点 → 本轮**合成一个动作节点**，并把它的参数当
   action 参数画（否则第 1234 行的流端点解析不到）。
3. **声明表不认端口体与动作用法** → `transform/textEdit.ts` 的
   `collectBody` 不递归 `portUsage.body`、也不收 `actionUsage` 系 →
   端口内特性 / action 参数**在画布上改名会静默失败**。本轮补上
   （`ACTION_USAGE_KINDS`）。

### 8.6 官方模型的关系条数：36 → 45

> ⚠️ 第六轮文档里写的「28 条」是**当时中途的数字**，没回写 —— 按第六轮
> 交付时的代码实测同一份官方模型是 **36 条边 / 572 个节点**。
> 本轮实测：**45 条边 / 632 个节点**（新增 46 个特性节点 + 10 个
> interface 端点 + 1 个合成的动作节点）。

| | 第六轮（实测） | 第七轮 |
|---|---|---|
| 能画成边的关系 | 36 | **45** |
| 画布节点 | 572 | 632（含 46 个特性节点） |

剩下 **24 条**画不出，原因逐条如下（**不是 bug**，是官方写法本身的信息量）：

| 原因 | 条数 | 例子 |
|---|---|---|
| 官方只给了**一半端点**（`then X;` / `first X;` 没有另一端） | 22 | `then fork fork1;`、`first start;`、`first wait;` |
| 端点是 **part 侧属性**（本轮范围外） | 1 | `allocate vehicleMassRequirement to PartsTree::vehicle_b.mass;`（`mass` 是 part def 体里的普通属性，按 §8.4 的范围决定仍走数量徽标） |
| 端点指向**不存在的元素** | 1 | 第 1442 行 `join3 -> done` —— 官方模型里根本没有 `done` 这个元素（全文只出现在这一行） |

> ⚠️ **更正上一版文档的一处错误归因**：曾把其中 1 条记成「端点是多层路径、
> 解析期被截成两段」。实测**不成立** —— 解析器对 `a.b.c.d` 是保留完整路径的
> （`partName` = 除末段外的整条路径），官方第 636 / 637 / 640 / 642 行那四条
> **三段 connect 全部正常画成了边**。本轮已补回归单测钉住这个能力
> （`tests/featureVisibility.test.ts` 的「多层端点」用例）。

### 8.7 后端 expose 作用域归一

后端此前有**两套** expose 作用域实现：

| 实现 | 文件 | 做法 |
|---|---|---|
| A | `internal/parser/viewBody.go` | 正则抽 expose 子句 + 按**包链** resolve |
| B | `internal/parser/viewBody_filter.go` | **逐行词法扫描**工程包内容建索引 + expr 求值 filter |

两套对同一段文本会给出不同结论 → 树上「⚠ 未解析」徽章与画布上明明有元素，
自相矛盾。而权威实现是**前端的 TS PEG**（`views/scope.ts`）。

本轮**删除 B**（含它的测试），后端只剩**一套**（A）。handler 的契约变成：

- 客户端送了 `exposedElements` → **原样存储**（浏览器路径，永远走这条）；
- 客户端没送（老客户端 / 脚本调用）→ 用后端唯一那套的解析结果。

⚠️ 两处**有意接受**的差异（都只影响兜底路径）：

1. 后端**不展开通配暴露**（`expose P::X::**`）—— 展开要遍历包内容，
   那正是被删掉的词法扫描器干的活；前端会展开并把结果一起送上来。
2. **filter 不参与作用域计算** —— 前端本来就不求值 filter，两端现在一致；
   filter 文本仍如实存进 `FilterQualifiedNames` 供 UI 回显。

`internal/expr`（Go 侧表达式引擎，TS 镜像，共享 conformance fixture）
**保留**，包注释里写明它不再参与 expose 作用域。

### 8.8 协作面板接 UI（两个孤儿组件）

`CommentsPanel`（M9 模型评论）与 `PresenceIndicator`（M13 在线用户）此前
**从未被任何页面 import** —— 后端 API 齐全、前端组件齐全，用户却既看不到评论、
也不知道谁在线。

- 新增 `services/commentsApi.ts` / `services/presenceApi.ts`：
  走 **scope 版本**接口（后端 M13 已把评论 / 在线从「模型」泛化成
  `package:` / `view:` / `model:` scope；老路由 `/models/:id/comments`
  匹配不到 M12 之后的实体）；
- 新增 `components/collab/CollabDrawer.tsx`：**绝对定位浮层**（不挤压画布 ——
  挤压会让 React Flow 重新量尺寸，影响既有 e2e 的坐标断言）；
- 工具栏加「在线 / 评论」两个入口，状态放 `uiStore.collabPanel`。

### 8.9 回归

- `poc-v2/tests/featureVisibility.test.ts`（**11 条**）：特性节点上画布、
  part 侧属性**不**上画布、`owner.feature` 端点解析、跨类型继承、
  载荷特性、特性改名能改到文本、官方模型关系 ≥ 40、特性节点 ≥ 40。
- `poc-v2/backend/internal/handler/viewScope_test.go`（**2 条**）：
  兜底路径用后端唯一解析结果；客户端送了就以客户端为准。
- `poc-v2/frontend/e2e/m19-collab-panels.spec.ts`（**5 条**）：
  入口存在、抽屉 scope 指向当前包、**发表评论后用 API 复核后端真的存下来了**、
  切到在线面板、关闭/重开。

## 二之九、第八轮：filter 语义落地 + 协作 e2e 补齐 + 两条小账

本轮的四项需求里，**A 项（多层端点路径）的前提被实测推翻**，另外三项都
落到了「产品真的坏了」的地方 —— 本轮共抓到 **3 个真 bug**。

### 9.1 🔴 真 bug ①：SSE 协同通道从来没通过（M13 整条链路是死的）

`frontend/src/hooks/useCollabStream.ts` 用的是浏览器原生 `EventSource`：

```ts
new EventSource(url, { withCredentials: true })
```

但 **EventSource 带不上 `Authorization` 头**（浏览器 API 限制，只能带 cookie），
而后端 `middleware.AuthRequired()` 只认该头：

```go
// backend/internal/middleware/jwt.go:120
token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
```

→ `GET /api/v1/events/stream` **一直 401**。

这意味着 M13 的整条实时通道 —— `comment_added` / `presence` /
`lock_changed` / `content_updated` 推送 —— **从来没工作过**。用户手动刷新页面
才能看到别人的评论。

**修法**：传输层从 `EventSource` 换成 **fetch + ReadableStream**：

- 带 `Authorization: Bearer <localStorage['sysmlv2.token']>`；
- **token 不进 URL**（避免 access log / Referer / 浏览器历史泄露）；
- 新增导出纯函数 `parseSseFrames(buffer)`：解析 `event:` / `data:` 帧，
  忽略 `: keepalive` 注释行（后端每 15s 发一次）；
- 保留指数退避重连 + `AbortController` 清理。

实测修复后 SSE 响应 **200**。

### 9.2 🔴 真 bug ②：元模型浏览器缺 `Part`

页面副标题写着「Block、Part、Port、Action 等」，但
`backend/internal/metamodel/mock.go` 的 28 个定义里**没有 Part** ——
用户按副标题去找必然扑空。

本轮补 `SysML::Part`（挂在 `SysML::Classifier` 下）+ 单测钉住
（`Get` / `Kind` / `Search` 三条断言）。

### 9.3 🔴 真 bug ③：M6 导入 handler 建的是 `model` 而不是 `package`

M12 之后工程树只吃 `packages` 表 —— 导入产物建在 `models` 表里，
**在树上根本挂不出来**（导入完等于什么都没发生）。

本轮改建 `packages` 表一行：

- 响应字段 `model` → `package`（前端 `ImportPage` 本来就兼容
  `result.package ?? result.model`）；
- 包名沿用旧约定：**上传文件名去掉后缀**；
- 同名包自动加 `_2` 后缀（而不是 409 失败）；
- **补写权限校验** —— 改造前这个 handler **完全没有权限检查**，
  任何登录用户都能往别人的私有工程里塞包。现在 404/403 拒绝
  （Go 单测钉住）。

### 9.4 filter 语义落地（官方 §7.24.3 / §8.2.2.26）

改造前 filter 是个**空壳**，有三个独立的断点：

| 断点 | 后果 |
|---|---|
| AST 把「expose 内联 filter」和「view 级 filter」混进同一个 `filters` 数组 | 作用域丢失 —— 分不清「筛这一条」还是「筛整个 view」 |
| `views/scope.ts` 解析 expose 时**完全不看** filter | `expose P::**` 永远返回全部成员 |
| `ExprIndex` **从不收集元素的 metadata 注解** | `filter @Safety` 这种注解分类测试**永远不可能命中** |

结果：`expose P::**; filter @Safety;` 把包里**全部**元素画到画布上，
filter 写了等于没写。

#### 9.4.1 AST 契约拆分

```ts
interface SysMLView {
  /** view 级 filter（body 里的独立 `filter X;`）—— 筛整个 view 的 membership */
  filters: string[];
  revealClauses?: ExposeClause[];  // 每条 expose 自带 inline（只筛那一条）
}
```

解析器不再把内联 filter 塞进 `filters`。

#### 9.4.2 注解从哪来（官方第 685 / 686 行）

```sysml
part bumper {@Safety{isMandatory = true;}}
```

注解 `@Safety` 是**该元素 body 里的一个 `metadataUsage` 成员** —— 所以
「元素 X 带 @Safety 注解」= 「X 的 body 里有 name==='Safety' 的 metadataUsage」。
另有 `about` 形态（官方第 892 / 1121 行）：

```sysml
@Rationale about engineTradeOffAnalysis::vehicle_b_engine4cyl { … }
```

注解属于**被指向**的元素，不属于它出现的命名空间。新模块
`poc-v2/views/filter.ts` 的 `collectAnnotations` 两种都支持。

#### 9.4.3 求值语义

- 多条 filter 之间 **AND**（官方 §7.24.3：filter 逐条限定 membership）；
- **解析失败的 filter 不生效**（不清空视图）—— 语法错误由 validator 报 W305，
  作用域计算不该因此把整个视图清掉；
- 内联 filter 与 view 级 filter **分别**作用。

#### 9.4.4 接线（顺序很重要）

`views/projection.ts` 新增：

```ts
resolveProjectScopeWithFilters(project, exposes, viewFilters)
```

**先按条内联筛，再按 view 级筛**。反过来会错：

```sysml
expose A [@X];
expose B;
filter @X;      // ← B 的元素不该被 A 的内联条件排除
```

前端 `modelStore` 的三处统一走这一套，保证**画布 / 落库 / 校验**三者一致：

1. 画布投影（`runPipeline` 的 transform）；
2. 保存时送上的 `exposedElements`（`computeScopeForSave`）；
3. 校验器的 expose 解析（`buildValidation.resolveExpose`）。

#### 9.4.5 往返保真

`transform/serializer.ts` 写回时把内联 filter **放回原来那条 expose 行**：

```sysml
expose P::A [@Safety];   ← 不是拆成两条独立子句
```

否则语义从「只筛这一条」变成「筛整个 view」。
`transform/importJson.ts` + `schema/sysml-v2-poc.schema.json` 补
`revealClauses`（含 `inline`）。

#### 9.4.6 能力边界（明确记录）

**包级 filter 未实现** —— 官方第 1524 行：

```sysml
package SafetyGroup {
    public import vehicle_b::**;
    filter @Safety;
}
```

那要求先解析包的 `import` 成员，本产品没有这层语义。
后端 `viewBody.go` 的 `FilterQualifiedNames` 仍只作 UI 回显，
**不参与作用域计算**（客户端权威，与 expose 一致）。

### 9.5 协作 e2e 补齐

新增 `poc-v2/frontend/e2e/m19-collab-multiuser.spec.ts`（**3 条**）：

1. 多用户 presence（第二个用户在线 → 第一个用户的「在线」面板能看到对方）；
2. 评论 SSE 实时刷新（**A 不刷新页面**也自动出现评论）；
3. 编辑锁徽章（第二个用户看到「正在编辑」）。

夹具要点：

- **两个浏览器上下文**（不同 localStorage token）；
- **每用例独立包**（隔离锁 / 评论 / presence scope —— 锁按包粒度、
  TTL 60s，页面关闭不一定发 release，跨用例会互相污染）；
- public 工程对「已登录非成员」仍 404 → 必须走 M4 正式路径
  （建团队 → 加成员 → 授权工程）；
- `teams.name` 有 **UNIQUE** 约束 → 团队名必须带唯一后缀
  （否则 500 → teamId 空 → AddMember 404）。

### 9.6 视图里的 FSM 仿真面板可达（M10 遗留缺口）

M10 的仿真面板判定是 `enableSimulation && stateMachines.length > 0`，
而 `stateMachines` 取自 `pipeline.model.stateMachines` —— **视图会话的文本模型**。
视图 content 里只有 view 定义 + expose 子句、没有状态机 → 条件恒为 false
→ 面板**永远挂不出来**。

修法：数据源改为 `collectStateMachines(pipeline.graphModel ?? pipeline.model)`
—— 视图会话的画布模型 = 视图模型 + 投影进来的源元素，状态机挂在合成包下、
不在平铺列表里。新增 `poc-v2/frontend/src/lib/simMachines.ts` +
`m19-view-simulation.spec.ts`（**2 条**）。

### 9.7 A 项（多层端点路径）：前提被实测推翻

用户的需求是「多层端点路径保真」。实测发现**多层端点本来就正常** ——
官方第 636 / 637 / 640 / 642 行那四条**三段 connect 全部正常画成边**，
解析器保留完整路径。

→ A 项降级为「补回归单测钉住已有能力 + 修正文档错误归因」。
第六轮文档里「多层端点解析期丢中段」的说法**不成立**，已在
`AGENTS.md` 第七轮段与本文件 §8.6 修正。

### 9.8 回归

| 项 | 结果 |
|---|---|
| 根 vitest | **643 / 644**（唯一失败 = 已记录的 ELK 负载敏感 flaky，单跑 10/10 绿） |
| frontend vitest | **850 / 850** |
| Go | 全绿 |
| frontend typecheck | clean |
| e2e | **110 / 110**（14 spec，17.1 分钟） |

新增/变更的测试：

- `poc-v2/tests/viewFilter.test.ts`（**11 条**）：注解收集（宿主形态 /
  限定名形态）、`@Safety` 命中、`not` 取反、多条 AND、解析失败不生效、
  元类测试、内联 filter 只筛那一条、view 级 filter 筛整体、两者叠加。
- `poc-v2/tests/importExport.test.ts` +3 条：内联 filter 写回留在原 expose 行、
  view 级 filter 写成独立子句、JSON 往返不丢内联 filter。
- `poc-v2/tests/featureVisibility.test.ts` +2 条（多层端点路径回归）。
- `poc-v2/frontend/e2e/m19-view-filter.spec.ts`（**3 条**）。
- `poc-v2/frontend/e2e/m19-view-simulation.spec.ts`（**2 条**）。
- `poc-v2/frontend/e2e/m19-collab-multiuser.spec.ts`（**3 条**）。
- `poc-v2/backend/internal/handler/importHandler_test.go`：改建 package +
  权限拒绝两条新用例。
- `poc-v2/backend/internal/metamodel/registry_test.go`：Part 存在性。
