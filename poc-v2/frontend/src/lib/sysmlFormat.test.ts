/**
 * SysML v2 快速格式化行为契约。
 *
 * 三条最要紧的不变量（顺序即重要性）：
 *   1. **保内容**：格式化只改空白 → `tokenFingerprint` 前后逐字节相同。
 *   2. **幂等**：`format(format(x)) === format(x)`（反复点格式化不会漂移）。
 *   3. **可解析**：格式化前后都能 parse 成功，且 package / def 成员结构不变。
 *
 * 另外钉死一批肉眼可见的排版规则（缩进、`;` 拆行、`::` 粘着、注释不动 …），
 * 免得后续重构把「排版手感」悄悄改掉。
 */

import { describe, expect, it } from 'vitest';
// 直接读仓库里的真实示例文件做回归基线：示例被改动时本用例会跟着暴露问题，
// 比在测试里抄一份拷贝更抗漂移。
import simpleCarSrc from '../../../examples/simple-car.sysml?raw';
import vehicleSystemSrc from '../../../examples/vehicle-system.sysml?raw';
import brokenSrc from '../../../examples/broken.sysml?raw';
import {
  formatSysML,
  formatSysMLSafe,
  tokenFingerprint,
  tokenizeSysML,
  formatStats,
} from './sysmlFormat';
import { parse } from '../../../parser/parser';
import { validate } from '../../../validator/validator';
import { modelToFlow } from '../../../transform/modelToFlow';

const EXAMPLES = {
  simpleCar: simpleCarSrc,
  vehicleSystem: vehicleSystemSrc,
  broken: brokenSrc,
};

// ─── 基础排版 ───────────────────────────────────────────────────────────

describe('formatSysML — 缩进与断行', () => {
  it('按 `{ … }` 嵌套重排缩进', () => {
    const src = 'package P {\npart def A {\nattribute x : Real;\n}\n}\n';
    expect(formatSysML(src)).toBe(
      ['package P {', '  part def A {', '    attribute x : Real;', '  }', '}'].join('\n') +
        '\n',
    );
  });

  it('`{` 留在声明头同一行，Allman 风格也会被收拢', () => {
    expect(formatSysML('package P\n{\npart a;\n}\n')).toBe(
      ['package P {', '  part a;', '}'].join('\n') + '\n',
    );
  });

  it('同一行的多条语句按 `;` 拆行', () => {
    expect(formatSysML('package P { part a; part b; }\n')).toBe(
      ['package P {', '  part a;', '  part b;', '}'].join('\n') + '\n',
    );
  });

  it('`};` 合并成一行（块后带分号）', () => {
    expect(formatSysML('package P {\npart a;\n};\n')).toBe(
      ['package P {', '  part a;', '};'].join('\n') + '\n',
    );
  });

  it('空块展开成两行', () => {
    expect(formatSysML('package P {}\n')).toBe('package P {\n}\n');
  });

  it('折叠行内多余空白，保留 `:` 的官方间距', () => {
    expect(formatSysML('part    def   A  :   B ;\n')).toBe('part def A : B;\n');
  });

  it('限定名 `::` 与区间 `..` 两侧不留空', () => {
    expect(formatSysML('import Powertrain :: *;\n')).toBe('import Powertrain::*;\n');
    expect(formatSysML('attribute r : Real [1 .. 5];\n')).toBe(
      'attribute r : Real[1..5];\n',
    );
  });

  it('`[` 贴紧前一个词（`wheels[4]` 是 SysML 主流写法，语法两种都接受）', () => {
    expect(formatSysML('part wheels [4] : Wheel;\n')).toBe('part wheels[4] : Wheel;\n');
    // 贴紧后仍可解析：Multiplicity 两侧的 `_` 在语法里是可选空白
    expect(parse(formatSysML('part wheels [4] : Wheel;')).errors).toHaveLength(0);
  });

  it('括号 / 方括号 / 分号 / 逗号周边不留多余空格', () => {
    expect(formatSysML('part wheels[ 4 ] : Wheel ;\n')).toBe(
      'part wheels[4] : Wheel;\n',
    );
    expect(formatSysML('constraint c { a == 1 , b == 2 ; }\n')).toBe(
      ['constraint c {', '  a == 1, b == 2;', '}'].join('\n') + '\n',
    );
  });

  it('可配置缩进单位', () => {
    expect(formatSysML('package P { part a; }', { indent: '    ' })).toBe(
      ['package P {', '    part a;', '}'].join('\n') + '\n',
    );
  });
});

// ─── 空行 ───────────────────────────────────────────────────────────────

describe('formatSysML — 空行处理', () => {
  it('连续空行折叠为 1 行', () => {
    const out = formatSysML('package P {\npart a;\n\n\n\n\npart b;\n}\n');
    expect(out).toBe(['package P {', '  part a;', '', '  part b;', '}'].join('\n') + '\n');
  });

  it('丢弃块首尾的空行', () => {
    const out = formatSysML('package P {\n\n  part a;\n\n}\n');
    expect(out).toBe(['package P {', '  part a;', '}'].join('\n') + '\n');
  });

  it('丢弃文件开头 / 结尾的空行，并保证末尾单个换行', () => {
    const out = formatSysML('\n\n\npackage P {\n  part a;\n}\n\n\n');
    expect(out).toBe(['package P {', '  part a;', '}'].join('\n') + '\n');
  });

  it('保留一处空行（作者的分段意图）', () => {
    const out = formatSysML('package P {\npart a;\n\npart b;\n}\n');
    expect(out).toBe(['package P {', '  part a;', '', '  part b;', '}'].join('\n') + '\n');
  });

  it('maxBlankLines: 0 时不留任何空行', () => {
    const out = formatSysML('package P {\npart a;\n\npart b;\n}\n', {
      maxBlankLines: 0,
    });
    expect(out).toBe(['package P {', '  part a;', '  part b;', '}'].join('\n') + '\n');
  });

  it('病态嵌套（几百个 `{`）不会把缩进撑爆', () => {
    const out = formatSysML('{'.repeat(300));
    const widest = Math.max(...out.split('\n').map((l) => l.length));
    expect(widest).toBeLessThan(200);
  });
});

// ─── 注释 / 字符串 / 引用名 ─────────────────────────────────────────────

describe('formatSysML — 注释与字面量', () => {
  it('行注释保留原样并独占一行缩进', () => {
    const out = formatSysML('package P {\n// 这是一条注释\npart a;\n}\n');
    expect(out).toBe(
      ['package P {', '  // 这是一条注释', '  part a;', '}'].join('\n') + '\n',
    );
  });

  it('行注释跟在语句后保持同行', () => {
    expect(formatSysML('package P {\npart a; // 车\n}\n')).toBe(
      ['package P {', '  part a; // 车', '}'].join('\n') + '\n',
    );
  });

  it('块注释保留行内位置', () => {
    expect(formatSysML('part def A /* 注释 */ {\npart b;\n}\n')).toBe(
      ['part def A /* 注释 */ {', '  part b;', '}'].join('\n') + '\n',
    );
  });

  it('多行块注释续行原样保留，不被重排版破坏', () => {
    const src = 'doc /*\n   第一行\n     缩进保持\n*/;\n';
    expect(formatSysML(src)).toBe(src);
  });

  it('字符串里的分号 / 大括号不触发拆行', () => {
    expect(formatSysML('attribute doc : String = "a; b { c }";\n')).toBe(
      'attribute doc : String = "a; b { c }";\n',
    );
  });

  it('带转义的引号不会提前结束字符串', () => {
    expect(formatSysML('attribute s : String = "he said \\"hi\\" ; ok";\n')).toBe(
      'attribute s : String = "he said \\"hi\\" ; ok";\n',
    );
  });

  it('单引号引用名（§7.26，可含空格）不被拆开', () => {
    expect(formatSysML("part def 'My Part' {\npart a;\n}\n")).toBe(
      ["part def 'My Part' {", '  part a;', '}'].join('\n') + '\n',
    );
  });

  it('未闭合的块注释不会吞掉后面的代码（指纹仍然守住了内容）', () => {
    const src = 'package P {\n/* 没关掉\npart a;\n';
    const out = formatSysML(src);
    expect(tokenFingerprint(src)).toBe(tokenFingerprint(out));
  });
});

// ─── 不变式 ─────────────────────────────────────────────────────────────

describe('formatSysML — 不变式', () => {
  const SAMPLES: Array<[string, string]> = [
    ['简单包', 'package P {\n  part def A {\n    attribute x : Real;\n  }\n}\n'],
    [
      '全在一行',
      'package P { part def A { attribute x : Real; port p : Q; } part a : A; }',
    ],
    ['缩进全错', 'package P {\n\t\tpart def A {\n\t\t\t\tattribute x:Real;\n}\n\n\n\n}\n'],
    ['CRLF', 'package P {\r\n  part a;\r\n}\r\n'],
    [
      '带注释与空行',
      '// 头\n\npackage P {\n  // 组 1\n  part a;\n\n\n  part b; // 尾注\n  /* 块注 */\n}\n\n',
    ],
    [
      '限定名 / 区间 / 端口重定向',
      'package P {\n  import Q::*;\n  attribute r : Real [1..5];\n  part u : A {\n    port :>> pp;\n  }\n}\n',
    ],
    ['空输入', ''],
    ['纯空白', '   \n\n  \n'],
    ['只有注释', '// 就一句\n'],
    ['语法错误（括号没闭合）', 'package P {\n  part def A {\n'],
  ];

  it.each(SAMPLES)('保内容：%s 格式化前后非空白 token 流完全相同', (_name, src) => {
    expect(tokenFingerprint(formatSysML(src))).toBe(tokenFingerprint(src));
  });

  it.each(SAMPLES)('幂等：%s 重复格式化不漂移', (_name, src) => {
    const once = formatSysML(src);
    expect(formatSysML(once)).toBe(once);
  });

  it.each(SAMPLES)('格式统一为 LF 且以单个换行收尾：%s', (_name, src) => {
    const out = formatSysML(src);
    expect(out).not.toContain('\r');
    expect(out === '' || out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

// ─── 与解析器的联动 ─────────────────────────────────────────────────────

describe('formatSysMLSafe — 安全守卫', () => {
  it('原文可解析 → 格式化后仍可解析，且结构等价', () => {
    const src = 'package P{ part def A { attribute x : Real; } part a : A; }';
    const r = formatSysMLSafe(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    const before = parse(src).model;
    const after = parse(r.content).model;
    expect(after.packages.map((p) => p.name)).toEqual(before.packages.map((p) => p.name));
    expect(after.packages[0]?.members?.length).toBe(before.packages[0]?.members?.length);
  });

  it('已经规范化的文本 → changed=false（不打扰用户）', () => {
    const src = 'package P {\n  part a;\n}\n';
    const r = formatSysMLSafe(src);
    expect(r).toEqual({ ok: true, content: src, changed: false });
  });

  it('原文本身解析不过时仍然允许格式化（用户正写到一半）', () => {
    const src = 'package P {\n  part def A {\n';
    expect(parse(src).errors.length).toBeGreaterThan(0);
    const r = formatSysMLSafe(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe('package P {\n  part def A {\n');
  });

  it('空内容不报错', () => {
    expect(formatSysMLSafe('')).toEqual({ ok: true, content: '', changed: false });
  });

  it('仓库内 3 个示例文件格式化后仍可解析且能往返', () => {
    // examples/ 下的样例是回归基线：格式化只能改排版，不能改语义
    const { simpleCar, vehicleSystem, broken } = EXAMPLES;
    for (const [name, src] of Object.entries({ simpleCar, vehicleSystem, broken })) {
      const r = formatSysMLSafe(src);
      expect(r.ok, `${name}: ${r.ok ? '' : r.reason}`).toBe(true);
      expect(tokenFingerprint(r.content)).toBe(tokenFingerprint(src));
      // 幂等 + 不劣化
      expect(parse(r.content).errors.length).toBe(
        name === 'broken' ? parse(src).errors.length : 0,
      );
    }
  });

  it('simple-car.sysml 的排版本身已是规范（只有 CRLF→LF 归一）', () => {
    // 仓库里 examples/*.sysml 是 CRLF 落盘的，格式化器统一输出 LF —— 所以
    // 「changed=false」的前提是先做换行归一，而不是文件逐字节相同。
    expect(EXAMPLES.simpleCar).toContain('\r'); // 确认这条用例真的在测 CRLF
    expect(formatSysML(EXAMPLES.simpleCar)).toBe(EXAMPLES.simpleCar.replace(/\r\n/g, '\n'));
  });

  it('vehicle-system.sysml 同理', () => {
    expect(formatSysML(EXAMPLES.vehicleSystem)).toBe(
      EXAMPLES.vehicleSystem.replace(/\r\n/g, '\n'),
    );
  });

  // 架构不变式（AGENTS.md）：`text → parse → validate → modelToFlow` 必须端到端
  // 等价。格式化只动排版，所以画布节点 / 边与校验结论都必须一模一样。
  it('格式化不改变画布：节点 / 边数量与标签完全一致', () => {
    const src = EXAMPLES.simpleCar;
    const formatted = formatSysML(src);
    const before = modelToFlow(parse(src).model);
    const after = modelToFlow(parse(formatted).model);
    expect(after.nodes.length).toBe(before.nodes.length);
    expect(after.edges.length).toBe(before.edges.length);
    const sig = (g: typeof before) =>
      g.nodes
        .map((n) => `${n.type}|${JSON.stringify((n.data as { label?: string }).label)}`)
        .sort()
        .join('\n');
    expect(sig(after)).toBe(sig(before));
  });

  it('格式化不改变校验结论', () => {
    for (const src of [EXAMPLES.simpleCar, EXAMPLES.vehicleSystem]) {
      const before = validate(parse(src).model).issues;
      const after = validate(parse(formatSysML(src)).model).issues;
      expect(after.map((i) => `${i.code}:${i.message}`)).toEqual(
        before.map((i) => `${i.code}:${i.message}`),
      );
    }
  });
});

// ─── 词法器 ─────────────────────────────────────────────────────────────

describe('tokenizeSysML', () => {
  it('把注释与字符串从 code 里剥出来', () => {
    const kinds = tokenizeSysML('a // c\n/* b */ "s"').map((t) => t.kind);
    expect(kinds).toContain('lineComment');
    expect(kinds).toContain('blockComment');
    expect(kinds).toContain('string');
  });

  it('归一 CRLF', () => {
    const toks = tokenizeSysML('a\r\nb\r\n');
    expect(toks.every((t) => !t.text.includes('\r'))).toBe(true);
  });

  it('行注释不含结尾换行', () => {
    const toks = tokenizeSysML('// x\npart a;');
    expect(toks[0]).toEqual({ kind: 'lineComment', text: '// x' });
  });

  it('未闭合字符串退化成只吃定界符', () => {
    const toks = tokenizeSysML('a = "\npart b;');
    expect(toks.some((t) => t.kind === 'string')).toBe(true);
    expect(toks.some((t) => t.kind === 'code' && t.text.includes('part b;'))).toBe(true);
  });
});

describe('formatStats', () => {
  it('统计行数与是否变化', () => {
    // `package P { part a; }` → package P { / part a; / }
    expect(formatStats('package P { part a; }')).toEqual({ lines: 3, changed: true });
    expect(formatStats('package P {\n  part a;\n}\n')).toEqual({ lines: 3, changed: false });
    expect(formatStats('')).toEqual({ lines: 0, changed: false });
  });
});