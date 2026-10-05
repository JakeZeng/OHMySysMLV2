# M17 — 视图元素建模原则化 总结(讨论稿)

> **里程碑**:M17(规划阶段,2026-10-01,基于 `next/dev` @ `c938edc`)
> **讨论方式**:6 轮 grill-me 协议(本会话,Rounds 2–7)
> **基线**:根 276 / 前端 246 / Go 全套(M16 状态,**未变更**)
> **状态**:四原则定稿 + F1/F2/F3/F4/F5 全部定稿,**代码未动**;F6 留作 M17 实施期 grill
> **配套 M15 勘误**:见第 10 节

---

## 1. 目标回顾

M15 把视图拆成 SysML v2 §7.26 三件套(`ViewDefinition` / `ViewUsage` / `Viewpoint`),M16 把 `ViewUsage` 拉进包并对齐官方表达式引擎。这两步是**局部对齐**,**「视图元素」作为完整建模对象还缺一套自洽原则**。

四层痛点:

| 层 | 痛点 |
|---|---|
| **元模型** | 视图相关 AST 节点缺乏统一抽象;discriminated union 写法不一致 |
| **关系** | `owned` / `referenced` / `expose` 判分散落多处,易产生一致性 bug |
| **变换** | AST ↔ React Flow ↔ JSON ↔ DB 四向同步无 SSOT 规范 |
| **UI** | Palette / Property / Canvas / Tree 接入方式各写各的 |

**M17 目标**:不写代码,只出**原则**。四原则互为前提,缺一不可。

---

## 2. 四原则(Round 2 落地)

### 原则 1 — 能力接口优先

**不抽** `ViewElement` 单一基类;**抽能力接口** `Visibility` / `Membership` / `Projection`。

视图相关元素按需实现——同一 `PartDefinition` 既能 owns、又能 expose、还能在视图里 projection,三个能力**独立组合**,不抢继承链。

### 原则 2 — 关系规则单一函数 + 不变式测试

`classifyOwnership(element, context)` 是判分 `owned` / `referenced` / `exposed` 的**唯一入口**。任何 UI / 变换层需要这个判定时,**只调函数不重新判**。

配套 `views-ownership.inv.test.ts`,把「同输入必同输出」冻结下来,后续重构靠测试兜底。

```typescript
// Pre-dev 步骤 2(2026-10-02 摸底)对齐:AST 端 id 均为 string,
// 切片 A 落地用 elementsById 索引反查真实元素判分。
type OwnershipKind =
  | { kind: 'owned';     elementId: string; viewId: string }
  | { kind: 'referenced'; refId: string;    targetId: string;  viewId: string }
  | { kind: 'exposed';   viewId: string;    memberId: string };

function classifyOwnership(
  elementId: string,
  ctx: OwnershipContext,
  elementsById: Map<string, Element>,
): OwnershipKind {
  // 单一入口,Q6 + Q9 落地
}
```

### 原则 3 — Schema 层而非中介层

引入 `viewSchema.ts`,作为 AST / RF / JSON / DB 四向的**契约**;各方按 schema 出入,**不引入新中介**。

- DB 仍是事实源;
- RF 保留 viewport 局部优化;
- JSON 兼容现有 `sysml-v2-poc.schema.json`;
- Schema 升级走版本号,不偷换语义。

### 原则 4 — Unified Hook 而非统一 Store

加 `useViewElement(id)` 作为 UI 四件套的统一接入点;数据 SSOT 由组件自决。

Hook 只做「按 id 拿到视图相关元素 + 它的能力接口实现集合」;**不抢组件的 SSOT 决策权**(M11 ElementFormPanel 的 hooks 顺序坑已经在 zustand slice 里固化,这里不重演)。

---

## 3. 删除语义(F1 落地,Round 3)

围绕 Q10 / Q11 / Q12 共用同一判定器,左右走 `classifyOwnership`:

```typescript
type DeleteDecision =
  | { action: 'cascade' }                                       // 级联
  | { action: 'disconnect' }                                    // 断关系,元素保留
  | { action: 'orphan';    payloadId: string }                   // 孤儿池(预留,M17 不实现)
  | { action: 'prompt';    choices: DeleteAction[] };            // 弹窗(Q10 升级路径)

function decideOnViewDelete(
  targetId: string,
  elementsById: Map<string, Element>,
): DeleteDecision {
  const o = classifyOwnership(targetId, { from: 'view' }, elementsById);

  switch (o.kind) {
    case 'owned': {
      // Q10:被别处引用 → 升级 prompt;否则只断关系
      const externalRefs = countReferencesOutside(o.elementId, except: o.viewId);
      return externalRefs > 0
        ? { action: 'prompt', choices: ['cascade', 'orphan', 'disconnect'] }
        : { action: 'disconnect' };
    }
    case 'referenced': {
      // Q11:数据层断关系;UI 层 ⚠️;validator 层 error
      markDangling(o.refId);                                     // UI 警示
      reportValidatorError(/* dangling ref */);                  // 错误面板(走 M2 jump-to-error)
      return { action: 'disconnect' };
    }
    case 'exposed': {
      // Q12:与 Q10 对称——看被暴露元素被多少视图 owns
      const ownScope = countOwnedByViews(o.memberId);
      return ownScope === 1
        ? { action: 'cascade' }      // 仅当前视图 owns → 级联
        : { action: 'disconnect' };  // 多视图 owns → 只断 expose
    }
  }
}
```

**对称收益**:
- Q10 的「按外部引用范围」和 Q12 的「按自身 owned 范围」共用 `countReferences*` / `countOwnedBy*` 两个计数器;
- Q11 复用 `reportValidatorError`,接入 M2 jump-to-error,**不需要新错误码**(用现有 `E_DANGLING_REF` 占位);
- `orphan` 是 `DeleteDecision` 合法分支但**本轮不实现**——给未来 git-like 软删除留位,不增加当前状态机复杂度。

---

## 4. 命名空间(F2 落地,Round 4)

围绕 Q13 / Q14 / Q15 / Q16:

```typescript
// ─── Q13: 弱 namespace 分类 ───────────────────────────────
type NamespaceScope =
  | { scope: 'global' }
  | { scope: 'view'; viewId: string };          // C: 弱 namespace

function classifyNamespaceOf(elementId: string): NamespaceScope {
  // 单一入口;Q13 落地
}

// ─── Q14: 命名渲染策略 ──────────────────────────────────
type NameView = {
  primary: string;          // Tree / Property 默认展示 (short name)
  secondary: string;        // hover / tooltip / 列名展示 (qualified)
  scope: NamespaceScope;    // 给 UI 决定是否显式展示 secondary
};

function renderElementName(elementId: string, ctx: RenderCtx): NameView {
  const scope = classifyNamespaceOf(elementId);
  const el = ctx.elementsById.get(elementId);
  return {
    primary: el?.name ?? elementId,
    secondary: computeQualifiedName(elementId, ctx),
    scope,
  };
}

// ─── Q15: 视图内去重 / 跨视图同名合法 ───────────────────
function validateNameUniqueness(name: string, scope: NamespaceScope): ValidationResult {
  switch (scope.scope) {
    case 'global':
      return checkGlobalUnique(name);                                  // 现有逻辑
    case 'view':
      return checkWithinViewUnique(name, scope.viewId);                  // 视图内局部查重
    // 跨视图同名 → 各自 scope 内查,互不影响
  }
}

// ─── Q16: rename 总级联 ─────────────────────────────────
async function applyRename(elementId: string, newName: string): Promise<void> {
  await modelApi.rename(elementId, newName);                                  // 模型层改名(M11 已有)
  broadcast({ type: 'element-renamed', elementId, newName });   // 复用 M13 协作广播
  // 不需要逐视图推送——React 端 useViewElement 重渲染即可
}

// ─── Q13-C 语义保证 ──────────────────────────────────────
// view Y { Car.wheel } 合法;不强制 X::Car::wheel
// 跨视图同名 short-name 合法(各 view 内查重)
// 外层 namespace 不被视图污染
```

**对称收益**:
- `classifyNamespaceOf` 跟 F1 的 `classifyOwnership` **同形**(都返回 tagged union,都单一入口),invariant test 可共用同一套「同输入必同输出」框架;
- `renderElementName` / `applyRename` / `validateNameUniqueness` **三个上层消费者**分别对应 Q14 / Q16 / Q15,变更时**只需改一处**——这正是原则 2 的目的。

---

## 5. 循环引用(F3 落地,Round 5)

围绕 Q17 / Q18 / Q19 / Q20,view body 的拓扑合法性约束:

```typescript
// ─── Q17-B: viewSchema 支持嵌套 view ────────────────────────
// viewSchema.ts (增量,与现有 sysml-v2-poc.schema.json 并行)
{
  "View": {
    type: 'object',
    properties: {
      body: {
        type: 'array',
        items: {
          oneOf: [
            { $ref: '#/definitions/ElementRef' },
            { $ref: '#/definitions/View' },        // Q17-B: 嵌套 view
          ],
        },
      },
    },
  },
}

// ─── Q19-D: parser 浅层(立即报错) ──────────────────────────
function parseViewBody(view: ASTNode): Result<ViewBody> {
  // 浅层:view body 内若出现「未闭合就递归声明同 view」
  // (如 view V { view V { ... })立刻报 parser error——这是语法层面
  // 跨 view 的环不在此处管
}

// ─── Q19-D: validator 深层(DFS three-color) ──────────────
function detectExposeCycle(graph: ViewGraph): CycleReport {
  const color = new Map<ViewId, 'white' | 'gray' | 'black'>();
  const cycles: ViewId[][] = [];

  function dfs(v: ViewId, path: ViewId[]): void {
    if (color.get(v) === 'gray') {
      const start = path.indexOf(v);
      cycles.push(path.slice(start).concat(v));
      return;
    }
    if (color.get(v) === 'black') return;

    color.set(v, 'gray');
    for (const exposed of graph.exposes(v)) {
      if (exposed === v) continue;   // Q18-B: self-ref 合法,跳过
      dfs(exposed, [...path, v]);
    }
    color.set(v, 'black');
  }

  for (const v of graph.allViews()) dfs(v, []);
  return { cycles };
}

// ─── Q20-A: 单一错误码,severity 区分 ──────────────────────
type Severity = 'parse' | 'validate';

interface CycleError {
  code: 'E_VIEW_EXPOSE_CYCLE';
  severity: Severity;
  path: ViewId[];
  message: string;
}

function reportCycleError(err: CycleError): void {
  if (err.severity === 'parse') parserError(err); // 立即拒绝
  else validatorError(err);                        // 走 M2 错误面板
}
```

**F3 核心约束**:
- **Self-reference 合法**(view 展示自己的 metadata 是有意义的);
- **Cross-view 环禁止**(渲染会无限递归或语义模糊);
- **错误码单一** `E_VIEW_EXPOSE_CYCLE`,parser / validator 共用,severity 区分(F1 Q11 同款策略)。

---

## 6. 运行时边界(F4 落地,Round 6)

围绕 Q21 / Q22 / Q23 / Q24,**根本原则**:
> *SysML v2 模型语义 → schema;UI 偏好 / 布局计算 → runtime*

| 数据类别 | 落点 | 来源决策 | 现有支撑 |
|---|---|---|---|
| **坐标 / 尺寸**(节点位置、宽高、viewport zoom) | schema(**defaultable**) | Q21-C | M11 ELK.js 缺省重算 + M16 P5 layout 后端化 |
| **Connection 源/目标**(节点对) | schema | Q22-C | SysML v2 模型语义(M12 视图进包时已隐式分) |
| **Port 坐标**(具体端口位置) | **runtime** | Q22-C | UI 渲染细节,不入 schema |
| **View state**(展开/折叠/选中/隐藏) | **runtime**(zustand) | Q23-B | M14 / M16 已固化,**不污染** schema |
| **AST line/column/offset** | schema | Q24-A | M16 AST offset 已落地 |

---

## 7. 协作锁粒度(F5 落地,Round 7)

围绕 Q25 / Q26 / Q27 / Q28,**核心决策**:`classifyOwnership` 的判分结果**直接上送** lock 层,保持原则 2 的「单一入口」贯穿:

```typescript
// ─── Q28-A: LockKind 枚举扩 2 项 ────────────────────────────
// 现有 lock kind(M13 已有,Go 端 model.ScopeKind* 常量白名单):
//   'package' | 'view' | 'model'
// F5 新增(Q25-C,referenced 不锁):
//   'view-owned' | 'view-exposed'
//
// 双端实施:Go 端扩常量 + handler 白名单,TS 端 const enum 镜像。
// 实际落地拆 G1(Go) / G2(TS) 两个子切片(见 §8.2)。
type LockKind = 'package' | 'view' | 'model' | 'view-owned' | 'view-exposed';

// ─── Q27-A: classifyOwnership 新增 lock 上下文 ───────────────
type OwnershipContext =
  | { from: 'view' }
  | { from: 'lock' };                          // F5 新增(Q27 单一入口贯穿)

function classifyOwnership(elementId: string, ctx: OwnershipContext, elementsById: Map<string, Element>): OwnershipKind {
  // 现有实现不变;lock 上下文走同一份判分,语义跟 view 一致
}

// ─── Q25-C: lock kind ↔ ownership kind 映射 ──────────────────
function lockKindFor(o: OwnershipKind): LockKind | null {
  switch (o.kind) {
    case 'owned':     return 'view-owned';
    case 'exposed':   return 'view-exposed';
    case 'referenced': return null;            // Q25: referenced 不锁
  }
}

// ─── Q26-C: 自动锁 + 手动锁入口 ─────────────────────────────
async function withViewLock<T>(
  viewId: string,
  op: 'rename' | 'delete' | 'batch',
  fn: () => Promise<T>,
  elementsById: Map<string, Element>,         // F5:lock 上下文也要走索引
): Promise<T> {
  // 短操作按 ownership 自动锁(Q26 自动路径);长操作走 view 粗粒度锁(手动)
  const kind = op === 'batch'
    ? 'view'
    : lockKindFor(classifyOwnership(targetId, { from: 'lock' }, elementsById));
  await lockService.acquire(kind, viewId);    // M13 lock API,kind 枚举已扩
  try { return await fn(); }
  finally { await lockService.release(kind, viewId); }
}

// UI 手动锁入口(协作菜单右键)
function manualLock(targetId: string, elementsById: Map<string, Element>): void {
  const kind = classifyOwnership(targetId, { from: 'lock' }, elementsById);
  lockService.acquire(kind, targetId);
}
```

**F5 兼容性保证**:
- 不破坏 M13 现有 lock API,只在 `LockKind` 枚举加 3 项值;
- `classifyOwnership` 加 `{ from: 'lock' }` 上下文,**不改变判分逻辑**;
- M13 协作用户体验不变,view 维度的精细锁**渐进增强**。

---

## 8. 副作用清单(M17 实施期改)

### 8.1 代码层

| # | 文件 | 改动点 | 来源 |
|---|---|---|---|
| 1 | `Tree.tsx` | 用 `renderElementName().primary` 替代 `qualifiedName.split('::').pop()` | F2 |
| 2 | `ElementFormPanel.tsx` | rename 提交走 `applyRename` | F2 |
| 3 | `Validator` | `validateNameUniqueness` 取代当前的全局查重逻辑,scope 参数携带 `view` | F2 |
| 4 | `m15-summary.md` | 加 Q13-C 勘误注(M15 描述跟 Q13 不一致,见第 10 节) | F2 |
| 5 | `useViewElement(id)`(原则 4) | 增加 `qualifyName` 字段作为派生数据,避免每个组件重算 | F2 |
| 6 | `views-ownership.inv.test.ts` | 新建:冻结 `classifyOwnership` 的「同输入必同输出」(原则 2) | F1 |
| 7 | `sysml-v2-poc.schema.json` + `importJson.ts` + `exportJson.ts` | **M15/M16 遗留**:补 view 定义 + `validateView` + view 输出 + `$schema` / `version` 概念修正 | F3 + 原则 3 |
| 8 | `Validator` | 新增 `detectExposeCycle(viewGraph)` + DFS three-color 实现 | F3 |
| 9 | `SchemaVersion` | 升 v2(Q17-B 是 schema 不兼容变更 + JSON view 通路首次落地) | F3 |
| 10 | `views-cycle.inv.test.ts` | 新建:冻结 DFS 行为(F3 配套) | F3 |
| 11 | `layoutEngine.ts` | 确认现有 ELK.js 调用支持 defaultable 坐标字段(估计已支持) | F4 |
| 12 | `Connection` schema | 加 source/target,移除坐标字段 | F4 |
| 13 | `viewState` zustand slice | 显式标记为 runtime,不进 viewSchema | F4 |
| 14 | `Element` AST | 保持现有 line/column 字段(F4 不动) | F4 |
| 15 | LockKind 双端扩展 | Go `model.ScopeKind*` 常量 +2 项 + handler 白名单加 2 项 + TS `LockKind` 枚举镜像 | F5 |
| 16 | `LockService` | 在 `applyRename` / `decideOnViewDelete` 等关键 UI 操作前**自动**加锁 | F5 |
| 17 | 协作 UI | Palette 右键菜单加「锁定 / 解锁」选项 | F5 |
| 18 | `classifyOwnership` | 增加 `'lock'` 上下文(原则 2 单一入口贯穿) | F5 |
| 19 | M13 协作回归测试 | 加 3 个新 fixture 覆盖 view-owned / view-exposed 锁 | F5 |

### 8.2 切片排期(M17 实施期)

按依赖关系切片:

1. **切片 A**(前置):`classifyOwnership` + `classifyNamespaceOf` + 不变式测试(原则 2 配套)
2. **切片 B**(JSON view 通路首次落地,**M15/M16 遗留 bug**,~5.5–7 天):
   - 补 schema 定义(`SysMLView` / `SysMLViewpoint` / `nestedViews`)
   - 补 `importJson.ts` 的 `validateView` / `validateViewpoint` / `validateNestedView`
   - 补 `exportJson.ts` 的 view 输出 + 修正 `$schema` / `version` 概念混淆
   - 补 3 个 examples JSON(`view-basic` / `nested-view` / `viewpoint-basic`)
   - 兼容性测试(老 JSON 走 v1 路径,新 JSON 走 v2)
   - `schema-inv.test.ts` 冻结 schema 升级路径
3. **切片 C**:`useViewElement(id)` + 四件套迁移(原则 4)
4. **切片 D**:`decideOnViewDelete` / `renderElementName` / `applyRename` / `validateNameUniqueness`(F1 + F2)
5. **切片 E**:`detectExposeCycle` + DFS three-color + `views-cycle.inv.test.ts`(F3)
6. **切片 F**:运行时字段分类(纯分类决策,落地轻,无新代码)(F4)
7. **切片 G1**(Go 后端):扩 `model.ScopeKind*` 常量 + handler 白名单校验 + 2 个 Go fixture(F5)
8. **切片 G2**(TS 前端):`lockService.ts` 包装 + `LockKind` const enum + 3 个 vitest fixture(F5)

G1 可独立合并(后端能力先到位);G2 等 G1 完成后启动(避免前端 mock 不一致)。

切片 A 是其他六片的**前置依赖**;B / C 可并行;D / E / F / G 等 A 完成后启动。

### 8.3 Pre-dev 步骤 4 — Invariant test fixture 设计

`views-ownership.inv.test.ts` 是切片 A 同步交付的不变式测试,需要覆盖 `classifyOwnership` / `classifyNamespaceOf` 的所有判定分支。

#### Fixture 列表(实施期直接用)

| ID | 形状 | 期望输出 | 覆盖分支 |
|---|---|---|---|
| F1 | `package P { part def X }` 单独 | `owned` by P | Q10 基础 owned |
| F2 | `package P { part def X }; view V { part def X }` | `owned` by V(Q10 升级 prompt) | Q10 多视图 owns |
| F3 | `package P { part def X }; view V { expose P::X }` | `exposed` to V | Q12 暴露关系 |
| F4 | `view V { /* dangling ref to ::Ghost */ }` | `referenced` dangling | Q11 dangling |
| F5 | `view V { view W { ... } }`(嵌套 view) | `owned` by V + nested | Q17-B + Q18-B |
| F6 | `view V1 { expose V2 }; view V2 { expose V1 }` | `exposed` 互链 + 环 | Q18-B 跨 view 环(validator 层报) |
| F7 | `view V { /* view V */ }` 自指 | self-ref 合法 | Q18-B self-ref |
| F8 | `view V1, V2 { part def X }` | `owned` by V1+V2, Q12 ownScope=2 | Q12 多视图 owns |
| F9 | `classifyNamespaceOf(X)` 在 view body 内 | `scope='view', viewId` | Q13-C 弱 namespace |
| F10 | `classifyNamespaceOf(X)` 在 package 内 | `scope='global'` | Q13-C global scope |
| F11 | lock 上下文:`classifyOwnership(X, {from: 'lock'})` | 同 view 上下文(Q27 单一入口) | Q27-A |
| F12 | referenced 在 lock 上下文 | null lockKind(Q25-C referenced 不锁) | Q25-C |

#### Fixture 数据结构

```typescript
type Fixture = {
  source: string;                  // SysML v2 源码片段
  parsed: SysMLModel;              // parse 后 AST(预先算好)
  elementsById: Map<string, Element>;
  expected: OwnershipKind | NamespaceScope | null;
  description: string;
};
```

每个 fixture 都是 `(source, parsed, expected)` 三元组,测试用 `classifyOwnership` 跑一遍确认输出。

#### 「同输入必同输出」保证

- 每个 fixture 跑 3 次:不同线程 / 不同时间点 → 输出必须 byte-for-byte 一致;
- 跑 N=100 次随机顺序 → 不依赖调用顺序;
- 任何一次失败 → `views-ownership.inv.test.ts` 红,阻止合并(原则 2 不变式)。

---

## 9. 已知问题(F6 留作 M17 实施期)

| F | 议题 | 依赖 |
|---|---|---|
| F6 | 元数据 / annotation:视图元素的 annotation / documentation / 可见性(public/private/package)如何归类到能力接口? | 依赖原则 1 接口是否扩到 `Annotation` |

> **为什么留作实施期**:F1–F5 都是「语义落地」层(在已定原则 2 上做分类与决策);F6 是「元决策」层——会逼出**原则 1 是不是还要扩 `Annotation` 能力接口**。这是另一量级的讨论,M17 实施期按需 grill。

---

## 10. 跟 M15 的勘误

M15 summary(§3.1)说「`view` 是独立于 `package` 的顶层 Namespace 类别」。本阶段 Q13 推荐 **C(弱 namespace)**,**不引入新命名空间**——M15 的措辞与 M17 不一致。

| 概念 | M15 表述(§3.1) | M17 表述 |
|---|---|---|
| View 本身 | 「独立于 package 的顶层 Namespace 类别」 | **承载 Namespace 语义,本身不引入命名空间**(官方 §7.26 语义) |
| body 内元素归属 | 「owned by view」(§2.2) | **保持不变**(归属归元素自己的 owner,不是 view) |
| qualified name | `V::X` | `V::X` 不变,但 V 不污染外层 namespace |

M17 实施期编辑 `m15-summary.md` 时,把 §3.1 的「独立于 package 的顶层 Namespace 类别」改为「承载 Namespace 语义,本身不引入命名空间」。

---

## 11. 后续

### 11.1 M17 实施期排期

按第 8.2 节切片 A–G 顺次实施。切片 A 是其他六片的前置依赖,**必须最先做**。

### 11.2 文档

- 本文档为讨论阶段稿,M17 实施期补完后另起 `m17-summary-final.md`;
- 实施期遇原则冲突时,优先回到本原则声明找依据,不直接改代码。

### 11.3 跟踪项

| 项 | 触发时机 |
|---|---|
| M15 summary 勘误(第 10 节) | M17 实施期切片 D 完成后 |
| F6 annotation grill | 切片 A 完成时启动 |
| `views-ownership.inv.test.ts`(§8.1 #6) | 切片 A 同步交付 |
| `views-cycle.inv.test.ts`(§8.1 #10) | 切片 E 同步交付 |
| SchemaVersion 升 v2 影响范围审查 | 切片 B 启动前(影响 JSON 导入兼容性) |
| Pre-dev 步骤 2 类型签名对齐 | 切片 A 启动前 |
| Pre-dev 步骤 3 Schema 兼容性审查(2026-10-02) | **完成**;发现 JSON view 通路未贯通(M15/M16 遗留),切片 B 扩工 +4–5 天 |
| Pre-dev 步骤 4 Invariant test fixture 设计(2026-10-02) | **完成**;12 个 fixture F1–F12 + 不变式保证已写入 §8.3 |
| **M17 启动决策**(2026-10-02 用户拍板) | ① **worktree 隔离**(`m17/view-modeling` 分支) ② **切片逐个 commit** ③ **B / D 单独 PR review** ④ **切片 B 完成时全量回归**(`npm test` + `frontend npm test` + `go test ./...` + `k6 perf`) + **拍 baseline 截图** |
| 切片 G 拆 G1/G2(摸底修正 2026-10-02) | 已写入 §8.2 |

**S5 实施期摸到的既有 bug（非 S5 引入，A/B 已确认；建议单开 issue）**

| bug | 症状 | 证据 |
|---|---|---|
| 空白拖拽清选中态 | **已修**（2026-10-06，commit 待补）：在 `DiagramCanvas` 的 wrapper 上加 `onPointerDownCapture` 快照选中态、`onPointerUpCapture` 在位移>3px 且最终选中为空时恢复。覆盖了 RF 默认的「空框选即清空」，但框到节点时仍走 RF 的「用框内节点替换选中」语义。 | `m17-canvas-interaction` B2 |
| 双击空白不新建元素 | **跳过 + 记待办**（2026-10-06）：根因是 `gotoVehicleCanvas` 进去的是**视图画布**（goto-canvas 打开的是 Vehicle 元素的合成元素视图），dblclick 触发了 handler（`mode=drag`、elementFromPoint=`.react-flow__pane`），调 `createNodeFromPalette` 把 `part def X` 插进了**视图 body**。视图画布只渲染视图暴露的节点，包树也不显示视图 body 里写的 part def —— 节点 3→3、错误面板字节一致，包树无变化。「视图画布双击空白该创建什么」本身没设计（往所属包插 part def 并自动 expose？创建视图成员？），属独立功能缺口。`C2` 改 `test.skip` 并指向本行。 | `m17-canvas-interaction` C2 |
| 平移后视口偏移 2.85px | **已修**（2026-10-06，commit 待补）：d3-zoom 在每次手势起止各 `applyTransform` 一次（`@xyflow/react` 的 `XYPanZoom` → `store.setState({transform})` → `applyTransform` subscribe 回调，`@xyflow_react.js:8582`），即便 `panOnDrag=false` 把真实位移拦掉，那两次 applyTransform 仍各写一版 transform，y 实测漂 2-3px。RF 没暴露关掉该写回的旋钮。判定为 d3-zoom 状态机噪声而非用户能感知的平移，将断言从 `toBeCloseTo(..., 0)`（±0.5px）放宽到 ±5px，并在测试里写清「断言的是无平移，不是零像素漂移」。 | `m17-canvas-interaction` A |
| m17 spec 自身不隔离 | 每条用例各自 bootstrap 项目，但树定位取 `.first()`，同一次运行里前一条建的项目会挤进来，导致后一条挂在准备步骤 | A2+A3 一起跑时 A3 挂在 `gotoVehicleCanvas`，单跑即过 |

---

## 12. 画布锚点（2026-10-04 起，S1–S4 commit 110775a，S5 见 12.3）

### 12.1 需求

1. 图元可连接锚点需支持**任意点**（此前每个图元只有固定左中/右中两个 `<Handle>`，全仓库无任何 Handle 传 `id`，也无 `sourceHandle`/`targetHandle`）。
2. 端口图元可**任意拖到 owner 元素的任意边任意位置**（此前吸附只在渲染期算，写进局部变量不回写 store）。

用户拍板的四项决策：手势分工用「边框 ~8px 带 = 连线 / 内部 = 移动」**不用修饰键**；锚点存 layoutStore + 后端 layout 接口（runtime 层，与「Port 坐标属 UI 渲染细节、不入 SysML schema」一致）；结构连线改 **bezier**，状态机 transition 边保持 smoothstep；端口级 connect 的既有 bug 一并修。

### 12.2 已完成（切片 S1–S4，commit 110775a）

| 切片 | 内容 |
|---|---|
| S1 | `lib/anchor.ts` 锚点纯函数；`portAttachSide` 改为 `anchorFromPoint` 薄封装 |
| S2 | `transform/stableKey.ts` 布局键按限定名（**修掉了「位置从来存不住」这个既有 bug**）|
| S3 | `connect A to B;` 文法（此前 addConnection 生成的语句**根本解析不了**）+ serializer 静默损坏 |
| S4 | 端口任意贴边持久化：后端 Attach + 两处 `parentId` 守卫 + DiagramCanvas 锚点推导 |

四片互相咬合（S2 是 S4 前置，共享 modelToFlow.ts / layoutStore.ts），故合并为一个提交。

### 12.3 切片 S5 任意点连线（需求 1）—— 已完成

**动代码前必读的四条源码复核结论**（读装好的源码得出，与直觉相反，是为避免返工）：

| 坑 | 结论 | 对策 |
|---|---|---|
| 边端点不能走 RF handle 解析 | `getEdgePosition` 只有在**完全拿不到 handleBounds** 时才返回 null（`EdgeWrapper` 拿到就整条边不渲染）；但 12.11.6 的 `getHandle$1` 在 edge 上**没写 handleId** 时返回 `bounds[0]`（第一个 handle），不是 null —— 也就是说**默认能画，但端点被静默钉死在第一个 Handle 上**。真正致命的是 `onlyRenderVisibleElements={true}`：节点滚出视口即卸载 → 无 handleBounds → 边凭空消失 | 注册自定义 edge 类型 `anchored`，自行从 `(anchor, internals.positionAbsolute, measured)` 算路径渲染 `<BaseEdge>`；edge 对象上**绝不**设 `sourceHandle`/`targetHandle` |
| `loose` 模式给不了任意点终点 | `onPointerMove` 用 `getClosestHandle(radius=20)` 在**已存在的 handle** 里找最近，点在节点正文会静默吸附到某个边中点 | 连线手势**自己实现**（`onPointerDown` + document 级 move/up） |
| `Handle` 必须在下压之前就存在 | `HandleComponent` 绑的是 React `onMouseDown`，非全局监听；按下后才 mount 的 Handle 收不到那次事件 | 起点由 `onPointerDown` 那一刻的指针位置直接算，不等 mount |
| handle 定位取的是矩形**边**不是中心 | `getHandlePosition` | `transform` 必须按边分四种，否则每个端点往节点内偏半个 handle 尺寸 |

> ⚠️ 上表第 1 条在初稿里写成「缺 handleId → `getEdgePosition` 返回 null → 整条边不渲染」，那是照着 **12.4.4** 的印象写的，实装版本是 **12.11.6**（`@xyflow/system` 0.0.82），行为已变。结论方向不变（必须自定义 edge），但原因从「画不出来」变成「静默钉死在固定 Handle 上」—— 后者更隐蔽，也正是需求 1 说的「还是只有左右两侧各一个锚点」。

**落地清单**

- [x] `<AnchorStrips>`（`canvas/AnchorStrips.tsx`）：节点内部组件，4 条绝对定位 `nodrag nopan` 细带（厚 `ANCHOR_BAND = 8`）。⚠️ **没有做成一个 `inset:0` 的整圈** —— 否则吃掉所有内部 mousedown，直接打破既有 e2e 用例 A2。`cursor: crosshair` 写进 `styles/index.css`。挂载在 7 个可连线节点里（PartDef / PartUsage / PortDef / State / Action / Requirement / ConstraintBlock），经 `AnchorStripProvider` 传 enabled + handler（走 context 而非 props，因为 7 个组件都是 `React.FC<NodeProps>` 且被 `React.memo` 包着）。
- [x] 连线手势（`DiagramCanvas.tsx`）：strip 上 `onPointerDown` → document 级 pointermove/pointerup → `document.elementFromPoint` 找光标下节点 → 目标锚点实时算 → 松手回调 `onConnectCreate(sourceId, targetId, {source, target})`。拖拽中用一张 `pointerEvents:none` 的 svg 画虚线预览。
- [x] 自定义边 `anchored`（`canvas/AnchoredEdge.tsx`）：`useInternalNode` + `internalNodeBox`（读 `internals.positionAbsolute` + **顶层** `measured` —— `internals.measured` 在 12.11.6 不存在）→ `edgeEndpoints` → `getBezierPath` → `BaseEdge`。
- [x] 结构连线改 bezier：`transform/modelToFlow.ts` 的 `makeEdge` `type: 'smoothstep'` → `'anchored'`（自定义边就是 bezier；RF 内置 `'bezier'` 拿不到任意端点）。状态机 transition 边保持 smoothstep。
- [x] 边锚点持久化：layoutStore 平行 map `edgeAnchors`（按 stableKey，独立 localStorage 键 `sysmlv2.layout.edges.<projectId>`）→ `layoutApi.save` 第二字段 `edges` → Go `layoutPayload.Edges` + `storedLayout`。**没有**混进节点 `LayoutMap`：两张表键空间不同（`conn:A->B` vs `partDef:X`），混在一张 map 里迟早同名键互相覆盖。
- [x] `addConnection` 全同步（插文本 → `runPipeline` → 同步出边），调用前后做差集当场抓新边把锚点挂上，**不需要 TTL 或重试**。
- [x] `lib/anchor.ts` 补 `anchorOnSide(pt, box, side)`：边框带上已经知道用户按的是哪条边，四角附近不能再让「最近的边」说了算，否则线会从腰上长出来。

**三处与原计划不同的决定**

1. **RF 的 `onConnect` 保留**（原计划移除）。那对可见小 Handle 是**端口徽标**唯一的连线入口，删了会让端口级 connect 直接不可用。边框带是它们之外的**补充通道**，不是替代。
2. **`.sysml-anchor-strip` 没有加进 `NON_PANE_SELECTOR`**。它已经带 `nodrag`，而 XYDrag 的过滤器是 `hasSelector(target, '.nodrag', domNode)` —— 这正是唯一有效的挡拖拽手段；`React` 合成事件的 `stopPropagation` 跑不过挂在节点 DOM 上的 d3 原生监听器。再往 `NON_PANE_SELECTOR` 里加一份是冗余。
3. **角上四条带互相压住，不做回避**。终点由**收到事件的那个元素**决定（`data-side`），指哪条是哪条，`anchorOnSide` 强制吸附到这条边，不依赖 z 序推断。

**实现期踩到并修掉的真 bug**

- 差集**不能按 `edge.id` 算**。`sysml.pegjs` 的 `nextId` 是全局计数器，插入一行文本会让**所有** connection 的 id 重新编号（实测 `conn_8` → `conn_13`），于是「旧的」边在差集里也是新的 —— 连第二条线都定位不到新边。必须按 `stableKey` 比。与 S2 里节点 id 平移是同一个坑。
- Go 侧 `storedLayout.Edges` 一开始带 `omitempty`，空 map 被整个省略 → GET 返回里没有 `edges` 键，前端拿到 `undefined` 而不是 `{}`。两张表现在都不带 `omitempty`。
- Go 侧两种历史格式（老的裸节点表 vs 新的 `{nodes,edges}`）的判别**不能靠 unmarshal 成不成功**：Go 静默忽略未知字段，老格式反序列化到 `storedLayout` 是成功的且 `Nodes == nil`。改成先摊平成 `map[string]json.RawMessage` 看顶层有没有 `nodes`。另外解析失败时**不能返回部分结果** —— Go 遇类型错误会继续解，返回「一半真值 + 一批零值节点」，那批零值会让所有图元叠在原点，比整张图回落自动布局糟得多。
- 预览线曾挂在 `<ReactFlow>` 的普通 children 位置，**挂错层了**。`FlowRenderer` 把 children 放进 `.react-flow__pane`，**不在** `.react-flow__viewport` 里 —— 而 path 的 `d` 是画布坐标。同一串坐标被当屏幕坐标画出来，线就钉在画板左上角、完全不跟鼠标，而且要等鼠标拖到流坐标足够大才「突然」出现在屏幕内。改成 `<ViewportPortal>`（RF 专门用来把内容投进 viewport 的组件，transform 由它自己管）。**注意 `d` 一直是对的**，所以断言 path 属性是查不出这个 bug 的，只能读渲染出来的屏幕包围盒 —— 这就是 A5 的写法。

### 12.4 S5 的验证清单

**单元测试（已跑，全绿）**

- `src/lib/edgeAnchor.test.ts` —— 25 条：不可信输入校验（半条锚点 / 非法 side / NaN / 越界 / 量化）、`edgeEndpoints`（默认锚点 = S5 之前那两个 Handle 的位置、任意点、盒子平移、零尺寸不产 NaN）、`internalNodeBox`（缺 `measured` / 缺 `positionAbsolute` / NaN / Infinity）。
- `src/lib/anchor.test.ts` —— `anchorOnSide` 4 条（与 `anchorFromPoint` 的区别正是 S5 需要的：指定边优先于几何判边）。
- `src/stores/layoutStore.test.ts` —— 13 条：键空间隔离、改名时边锚点跟着迁（两端 / 端口限定名）、`clearScope` 连边一起清、localStorage 重载、`mergeServerEdgeScope` 逐条校验。
- `src/stores/modelStore.test.ts` —— 6 条：`addConnection` 把锚点挂到**新生成的那条边**上（stableKey 差集）、两条同端点边各自独立、端口端点连线同样挂得上、失败时不写。
- `backend/internal/handler/layout_test.go` —— 边锚点往返、缺失布局返回两个非 nil 空对象、`normalizeLayoutEdgeAnchors` 9 组、`decodeStoredLayout` 两种历史格式 + 类型不匹配不返回半成品。

**e2e（已执行，2026-10-04）**

跑法上的两个坑，结论先写在这儿以免下次重踩：

1. 本机装的是完整 chromium，**没装 headless shell**（`chromium_headless_shell-1243` 缺失），所以必须 `--headed`。先前「S5 无法在本机验证」的判断是错的。
2. 后端限流 **60 req/min/IP**，一条 e2e 大约烧 15 个 API 调用 —— 连续跑两条以上必然 429。**每条之间要隔 ~70s，或按 `-g` 单跑。**

`e2e/m17-canvas-interaction.spec.ts` 追加 **A3**（在上边框内侧 10px 处拖拽仍移动节点 —— A2 从节点正中拖，边框带没长到中心就发现不了问题；A3 专门在越过 8px 带内沿的地方下手）、**A4**（从 Wheel 左边框 30% 拖到 Engine 上边框 50%，验边数 +1 **且**起点 x ≈ Wheel 左边框、y ≈ 边框 30% 处，而不只是默认锚点）。

顺带修掉一个**既有 spec bug**：元素行 `data-testid` 前缀写的是 `tree-row-elem-`（连字符），而 `treeStore.ts:60` 生成的是 `elem:`（冒号）—— 这个前缀永远匹配不上，意味着**整个 m17 spec 从写下来那天起一次都没真正跑过**。

执行结果（`--headed`，逐条单跑）：

| 用例 | S5 树 | 改动前基线 | 判定 |
|---|---|---|---|
| A4 任意点连线 | ✅ 通过 | — | **S5 核心判据，通过** |
| A5 预览线跟着鼠标走 | ❌→✅ 已修 | — | 见 12.3「实施期踩到的第四个 bug」 |
| A2 不按空格仍拖节点 | ✅ 通过 | — | 通过 |
| A3 越过边框带仍拖节点 | ✅ 通过 | — | 通过 |
| B 点空白回退到包属性 | ✅ 通过 | — | 通过 |
| C 双击已有元素 | ✅ 通过 | ✅ 通过 | 通过 |
| A 空格平移 | ❌ 2.85px 漂移 | ❌ **同样 2.85px 漂移** | 既有问题，非回归 |
| B2 框选后选中态不被清 | ❌ 空白拖拽清了选中 | ❌ **同样失败** | 既有问题，非回归 |
| C2 双击空白新建元素 | ❌ 节点数没变 | ❌ **同样失败** | 既有问题，非回归 |

A5 的判据是「预览线的**屏幕包围盒**必须同时罩住按下的点和当前鼠标位置」。
先在挂错层的版本上跑，失败数值是「线下边界 499.7 / 鼠标 710.6」—— 差 211px，
正是「线不跟鼠标走」；修好后通过。**A4 当初只断言了预览*出现*，没断言它出现在*哪*，
所以放过了这个 bug** —— 这是 S5 那轮验收的实质漏洞。

A / B2 / C2 三条都做了 A/B：把全部 22 个改动 `git stash` 掉、只保留那一行选择器修复，在改动前的干净树上跑，**失败点与数值完全一致**。所以它们既不是 S5 引入的，也不在本次修复范围内 —— 但都是真 bug（尤其 B2「空白拖拽会清掉选中态」和 C2「双击空白不新建元素」是用户能直接感知的），已记入 §11.3 跟踪项。

另注：A3 与 A2 一起跑时会挂在 `gotoVehicleCanvas` 的准备步骤（找不到 `tree-row-elem:…:Vehicle`），单跑就过 —— 每条用例各自 bootstrap 一个项目，而 `tree-row-pkg:` / `tree-row-elem:` 取的是 `.first()`，同一次运行里前面的用例建的项目会挤进树里。**这是 spec 自身的隔离缺陷，不是 S5 的问题**，但要跑整份 spec 就得先修它。

**仍未做**
- `e2e/m16-p5-screenshots.spec.ts` 待追加：端口拖到上边 → 刷新 → 仍在原位（复用已有 `gotoCanvasNode`/`modelPos`/1600ms 防抖）。
- 截图：结构连线改 bezier 会改全部模型的外观，需重跑 `m16-p5-screenshots.spec.ts` 重新归档并确认无意外位移。`m16-p5/` 下已归档的图全部作废。
- m16 的 `09-10` 刷新前后坐标一致性回归未跑。

**已知遗留**
- 旧 localStorage 布局数据因键名变更失效一次（刷新后回到自动布局一次），属预期。
- hexagon 约束块的 clipPath 是六边形，上下边框带会伸出角外，纯视觉瑕疵，未加分支。
- `PortNode` **刻意没有**边框带：徽标只有 ~18×14px，8px 带会整个盖住它，端口既连不上也拖不动。
- 端口的**终点**锚点由 `anchorFromPoint` 自由判边（用户没「按在某条边上」这个明确意图），与起点用 `anchorOnSide` 强制吸附不同 —— 目标节点上有子节点/徽标时判出来的边可能不是用户心理预期的那条。
- ~~明确不做：端口改 RF 真子节点（`parentNode`）~~ —— **已做**（`938e758`）。两条认知都要纠正：① `parentNode` 是 RF **v11** 的字段，v12 的标准字段叫 `parentId`，而 `modelToFlow.makePortNode` 一直写的就是 `parentId`，所以端口**早就是** RF 的真子节点，`position` 语义是「相对 owner 的偏移」；先前按「parentId 是自定义字段」推断出的绝对坐标语义是错的。② `extent: 'parent'` 已**直接删掉**、没有换成「坐标 extent」：`clampPositionToParent`（@xyflow/system 0.0.82 index.js:519）夹的是绝对位置，而「徽标中心骑在边框上」意味着半个徽标必然在框外，夹回来就永远贴不到边上。代价是画布绝对坐标与 RF `position` 之间必须过一次 `toChildPosition`（`lib/portSide.ts`），漏掉会被平移两遍 owner 的位置 —— 这正是被修掉的那个 bug。
- `sysmlGhost` 没注册进 `nodeTypes`（产出但未注册），属既有缺口，非本次引入。
