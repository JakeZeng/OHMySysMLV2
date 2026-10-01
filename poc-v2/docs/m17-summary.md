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
| 7 | `viewSchema.ts` | 新建:Q17-B 嵌套 view schema | F3 |
| 8 | `Validator` | 新增 `detectExposeCycle(viewGraph)` + DFS three-color 实现 | F3 |
| 9 | `SchemaVersion` | 升 v2(Q17-B 是 schema 不兼容变更) | F3 |
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
2. **切片 B**:`viewSchema.ts` + SchemaVersion 升 v2(原则 3)
3. **切片 C**:`useViewElement(id)` + 四件套迁移(原则 4)
4. **切片 D**:`decideOnViewDelete` / `renderElementName` / `applyRename` / `validateNameUniqueness`(F1 + F2)
5. **切片 E**:`detectExposeCycle` + DFS three-color + `views-cycle.inv.test.ts`(F3)
6. **切片 F**:运行时字段分类(纯分类决策,落地轻,无新代码)(F4)
7. **切片 G1**(Go 后端):扩 `model.ScopeKind*` 常量 + handler 白名单校验 + 2 个 Go fixture(F5)
8. **切片 G2**(TS 前端):`lockService.ts` 包装 + `LockKind` const enum + 3 个 vitest fixture(F5)

G1 可独立合并(后端能力先到位);G2 等 G1 完成后启动(避免前端 mock 不一致)。

切片 A 是其他六片的**前置依赖**;B / C 可并行;D / E / F / G 等 A 完成后启动。

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
| 切片 G 拆 G1/G2(摸底修正 2026-10-02) | 已写入 §8.2 |