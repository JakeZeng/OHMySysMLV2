/**
 * M17：稳定键（stableKey）—— 跨 pipeline 重建不漂移的元素标识。
 *
 * ## 要解决的问题
 *
 * React Flow 的 `node.id` 直接用解析器给的 AST id（`pd:partDef_17`），
 * layoutStore 与后端 layout 也按这个 id 存键。但 `sysml.pegjs:46` 的 `nextId`
 * 是**单调递增计数器**：在文件开头插一行 `part def X;`，后面所有元素的 id
 * 全部 +1。于是用户改一次名字，已保存的位置/锚点就对不上，布局整体重排。
 *
 * 判据很简单：**键只能依赖语义，不依赖出现次序**。
 *
 * ## 键的构成
 *
 *   partDef:Vehicle::Car          元素 → `<类别>:<限定名>`
 *   port:Vehicle::Car::powerOut   端口 → `port:<owner 限定名>::<端口名>`
 *   conn:A::p1->B::p2            边   → `conn:<源限定名>-><目标限定名>`
 *
 * 限定名由 `collectMembers` 沿 namespace 递归时逐层拼出来 —— AST 里没有
 * qualifiedName 字段（见 ast/model.ts），不能在事后反查，只能收集时带上。
 *
 * 改文本会改变键的情形（**可接受**，属于用户主动改语义）：
 *   - 改名 → 该元素的键变了（`renameNode` 按新名迁移那一个键，见 S2）
 *   - 移动成员所属的包 → 限定名变了
 *   - 删除元素 → 该键不再被读（残留条目不回收，是既有行为）
 *
 * 改文本**不会**改变键的情形（本模块的全部意义）：
 *   - 在别处增删元素、改任意类型的 body、改注释 / 缩进 / 空行
 *
 * ## 重名消歧
 *
 * 同名元素是合法的（如两个包各自都有 `part def Engine`）。限定名相同会让键
 * 撞车，后写者把先写者的位置覆盖掉 —— 表现为两个节点重叠且拖不动。
 * `StableKeys.alloc` 给重复的基名加 `#2`、`#3` 后缀，按收集顺序（即文档顺序）
 * 分配，顺序稳定则分配结果也稳定。
 */

/** 收集期路径拼限定名：过滤掉隐式根包这类空名段。 */
export function joinQName(path: string[], name?: string): string {
  const segs = [...path];
  if (name) segs.push(name);
  return segs.filter((s) => s && s.length > 0).join('::');
}

/** 元素基名（尚未消歧）：`<类别>:<限定名>`。 */
export function elementKeyBase(kind: string, qname: string): string {
  return `${kind}:${qname || '<anon>'}`;
}

/** 端口基名：端口短名在 owner 命名空间下唯一，用 owner 限定名消歧跨 owner 重名。 */
export function portKeyBase(ownerQName: string, portName?: string, redefines?: string): string {
  // `port :>> foo;` 这种匿名端口没有 name，退而用 redefines；都没有则 <anon>，
  // 交给 alloc() 的 #n 后缀兜底。
  const label = portName || redefines || '<anon>';
  const owner = ownerQName || '<root>';
  // 分隔符用 `::` 与元素限定名保持一致 —— owner 自身也含 `::`，
  // 单个 `:` 分隔在排查问题时看不出 owner 到哪结束。
  return `port:${owner}::${label}`;
}

/**
 * 边基名。带方向，因为连接是有向的 —— `A->B` 与 `B->A` 是两条不同的边，
 * 共用一个键会让两条线互相抢锚点。
 */
export function connKeyBase(source: string, target: string): string {
  return `conn:${source || '<anon>'}->${target || '<anon>'}`;
}

/**
 * 基名 → 唯一键的分配器。
 *
 * 每次 pipeline 重建图时新建一个实例，分配顺序即收集顺序（文档顺序）。
 */
export class StableKeys {
  /** 基名 → 已分配次数 */
  private used = new Map<string, number>();

  /** 取一个未占用的键；首次返回基名，重复则加 `#2`、`#3` … */
  alloc(base: string): string {
    const n = this.used.get(base);
    if (n === undefined) {
      this.used.set(base, 1);
      return base;
    }
    this.used.set(base, n + 1);
    return `${base}#${n + 1}`;
  }
}

/** 从节点的 `data.stableKey` 取键；没有则退回节点自身 id（保持旧数据可读）。 */
export function stableKeyOf(data: unknown, fallback: string): string {
  const k = (data as { stableKey?: unknown } | null | undefined)?.stableKey;
  return typeof k === 'string' && k.length > 0 ? k : fallback;
}

/**
 * 元素改名后，旧 stableKey 对应的新键。
 *
 * 改名要能在 **runPipeline 之前** 算出新键 —— 否则新图已经按旧键查不到位置、
 * 回落到自动布局，再迁移条目也来不及（迁移发生在渲染之后，节点坐标已经定了）。
 *
 * 只替换键的**最后一段**（元素名 / 端口名）。键的构造保证了名字一定在末尾：
 *   partDef:Vehicle::Car          → partDef:Vehicle::Automobile
 *   port:Vehicle::Car::powerOut   → port:Vehicle::Car::energyOut
 *   partDef:Car（无包前缀）        → partDef:Automobile
 * `#n` 重名后缀原样带过去（改名不改变同名消歧的次序）。
 *
 * 末段与 `oldName` 对不上时**原样返回** —— 匿名端口（键末段是 `<anon>``，
 * 界面上的标签却是 `:>> x`）这类改不了名的键，宁可不迁也不要迁到错误的键上。
 */
export function renameStableKey(oldKey: string, oldName: string, newName: string): string {
  const hashAt = oldKey.search(/#\d+$/);
  const base = hashAt >= 0 ? oldKey.slice(0, hashAt) : oldKey;
  const suffix = hashAt >= 0 ? oldKey.slice(hashAt) : '';
  // 段分隔符优先 `::`；没有 `::` 时退回 `:`（`partDef:Car` 这种无包前缀的键）
  const sep = base.lastIndexOf('::');
  const cut = sep >= 0 ? sep + 2 : base.lastIndexOf(':') + 1;
  if (cut <= 0) return oldKey;
  const head = base.slice(0, cut);
  if (base.slice(cut) !== oldName) return oldKey;
  return `${head}${newName}${suffix}`;
}