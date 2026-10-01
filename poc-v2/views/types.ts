/**
 * M17 — 视图元素建模原则化的共享类型。
 *
 * 原则 2 单一入口配套:
 *   - `OwnershipKind` —— 元素的归属 / 暴露 / 引用关系(discriminated union)
 *   - `NamespaceScope` —— 元素所在的命名空间视图
 *   - `OwnershipContext` —— `classifyOwnership` 的调用上下文(view 决策 / lock 决策)
 *   - `LockKind` —— M13 lock 类型 + M17 切片 G 双端扩展占位
 *
 * 所有调用方按 tagged union 解构,不再额外做 kind 字符串判断以外的判分。
 */

import type { SysMLModel, NamespaceMember } from '../ast/model';

// ─── Element 索引形态 ─────────────────────────────────────────────────────

/**
 * 元素索引元素 ID 的最小 footprint。SysMLModel 内任何带 id 的节点都可索引。
 *
 * 完整 AST 节点的 union 会触发跨文件循环依赖;这里只声明「有 id 的命名空间成员」
 * 即可覆盖切片 A 的全部 fixture(F1-F12 都不依赖未索引成员)。
 */
export type ElementIndex = ReadonlyMap<string, NamespaceMember>;

// ─── Ownership 关系 ──────────────────────────────────────────────────────────

/** 谁可以 owns 一个元素(命名空间类别)。viewpoint 与 view 同形,Q13-C 弱 namespace。 */
export type OwnerKind = 'package' | 'view' | 'viewpoint';

/**
 * F1 落地(Round 3 拍板,Q6/Q9):
 *   - `owned`     —— 元素是某个命名空间的直接成员(无论 package / view / viewpoint)
 *   - `referenced` —— 元素是某 view body 内 reveal 的悬挂目标(路径存在但目标解析失败)
 *   - `exposed`   —— 元素被某 view reveal(归属仍是其命名空间 owner,view 不引入 namespace)
 *
 * 注意:`viewId` 字段在 `exposed` / `referenced` 分支特指 view 自身,
 * 在 `owned` 分支兼容 `OwnerKind` 三类(命名空间统一抽象)。
 */
export type OwnershipKind =
  | { kind: 'owned';      elementId: string; ownerId: string; ownerKind: OwnerKind }
  | { kind: 'referenced'; refId: string;     targetId: string; viewId: string }
  | { kind: 'exposed';    viewId: string;    memberId: string };

/**
 * 原则 2:同一入口贯穿 view 决策 + lock 决策(F5 Q27-A)。
 * 两种 ctx 走同一份判分代码,差异在策略允许层(`lockKindFor` 等)。
 */
export type OwnershipContext =
  | { from: 'view' }
  | { from: 'lock' };

// ─── Namespace 视图(F2 Q13-C 弱 namespace) ──────────────────────────────────

/**
 * 弱 namespace 分类:`global`(包内 / 顶层)/ `view`(视图内 owned)。
 *
 * 注意:**view 本身不引入命名空间**(M17 §10 勘误)——这里 `scope='view'` 是给 UI
 * 决策层「要不要在视图子作用域里查重」的标记,**不**意味着元素进入新 namespace。
 */
export type NamespaceScope =
  | { scope: 'global' }
  | { scope: 'view';   viewId: string };

// ─── Lock 类型(F5 双端扩展占位)────────────────────────────────────────────

/**
 * M13 现有 lock kind + M17 切片 G 新增 view-owned / view-exposed。
 *
 * 切片 A 不实际加锁逻辑;只在 `lockKindFor` 辅助函数里建立 ownership → lock
 * 的映射,G1(Go 端)/ G2(TS 端)在切片 G 落地时按本枚举镜像。
 *
 * referenced 不锁(Q25-C),`lockKindFor` 返回 null。
 */
export type LockKind =
  | 'package'
  | 'view'
  | 'model'
  | 'view-owned'
  | 'view-exposed';

// ─── 副作用决策(F1)────────────────────────────────────────────────────────

/**
 * F1 落地:删除语义(Q10 / Q11 / Q12)。`orphan` 是合法分支但本轮不实现——给
 * 未来 git-like 软删除留位,不增加当前状态机复杂度。
 */
export type DeleteDecision =
  | { action: 'cascade' }
  | { action: 'disconnect' }
  | { action: 'orphan';    payloadId: string }
  | { action: 'prompt';    choices: DeleteAction[] };

export type DeleteAction = 'cascade' | 'orphan' | 'disconnect';

// ─── Model 入口 ─────────────────────────────────────────────────────────────

/** `buildElementsIndex` 的输入。SysMLModel 已经是 SSOT,无需二次拷贝。 */
export type IndexableModel = Pick<SysMLModel, 'packages' | 'views' | 'viewpoints'>;