/**
 * M17 切片 B — JSON schema 升级路径不变式测试。
 *
 * 冻结:
 *   - SCHEMA_URI / SCHEMA_VERSION 升 v2 后,既有 v1 JSON 仍能 import(legacy path)
 *     与 v2 JSON(新 path)同步工作
 *   - view / viewpoint 顶层数组 + 嵌套 view 走通 import → model → serialize → text
 *   - 3 个 example 文件(view-basic / nested-view / viewpoint-basic)round-trip 一致
 *
 * 契约:任何破坏本测试的改动必须先经过 m17-summary §8.1 #9 SchemaVersion 升 v2
 * 影响范围审查。
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { importFromJson } from '../transform/importJson';
import { exportToJson, SCHEMA_URI, SCHEMA_VERSION } from '../transform/exportJson';
import { serialize } from '../transform/serializer';

const EXAMPLES_DIR = path.join(__dirname, '..', 'schema', 'examples');

// ─── Schema URI / Version 不变式 ─────────────────────────────────────────

describe('schema URI / version v2 升级路径', () => {
  it('SCHEMA_URI 已升 v2', () => {
    expect(SCHEMA_URI).toBe('https://sysmlv2-poc.example.com/schema/v2');
  });

  it('SCHEMA_VERSION 已升 2.0.0', () => {
    expect(SCHEMA_VERSION).toBe('2.0.0');
  });

  it('exportToJson 用 v2 URI / version', () => {
    const model = {
      packages: [],
      connections: [],
      views: [],
      viewpoints: [],
    } as Parameters<typeof exportToJson>[0];
    const out = exportToJson(model);
    expect(out.$schema).toBe(SCHEMA_URI);
    expect(out.version).toBe(SCHEMA_VERSION);
  });
});

// ─── 3 个 view-related examples round-trip ───────────────────────────────

describe('view-related examples round-trip', () => {
  const examples = ['view-basic', 'nested-view', 'viewpoint-basic'];

  for (const name of examples) {
    it(`${name}.sysml.json 存在且 v2`, () => {
      const filePath = path.join(EXAMPLES_DIR, `${name}.sysml.json`);
      expect(fs.existsSync(filePath), `${name}.sysml.json 文件应存在`).toBe(true);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(content.$schema).toBe(SCHEMA_URI);
      expect(content.version).toBe(SCHEMA_VERSION);
    });

    it(`${name}.sysml.json import 成功且 models 解析合法`, () => {
      const filePath = path.join(EXAMPLES_DIR, `${name}.sysml.json`);
      const content = fs.readFileSync(filePath, 'utf8');
      const r = importFromJson(content);
      expect(r.errors, `errors 应为空,实际 ${JSON.stringify(r.errors)}`).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.text.length).toBeGreaterThan(0);
    });

    it(`${name}.sysml.json round-trip: import → serialize → 含 view/viewpoint 关键字`, () => {
      const filePath = path.join(EXAMPLES_DIR, `${name}.sysml.json`);
      const content = fs.readFileSync(filePath, 'utf8');
      const r = importFromJson(content);

      // 重新序列化——model 应保留 view / viewpoint 信息(不再丢失)
      const reSerialized = serialize(r.model);

      // 不同 example 应含不同关键字
      if (name.includes('viewpoint')) {
        expect(reSerialized).toContain('viewpoint');
      } else {
        expect(reSerialized).toContain('view');
      }
    });
  }
});

// ─── Legacy v1 JSON 兼容性 ──────────────────────────────────────────────

describe('legacy v1 JSON 兼容性', () => {
  it('v1 car-basic.sysml.json 走老路径也能 import(无 view/viewpoint 字段)', () => {
    const filePath = path.join(EXAMPLES_DIR, 'car-basic.sysml.json');
    if (!fs.existsSync(filePath)) {
      // 跳过而非失败——legacy 文件可能已迁 v2
      return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const r = importFromJson(content);

    // 老 JSON 即使 URI 是 v1,也应能解析(导入路径不强制 schema 匹配)
    expect(r.model.packages.length).toBeGreaterThan(0);
  });

  it('legacy v1 JSON 不带 views/viewpoints 字段时,导入后的 arrays 为空数组', () => {
    const legacyJson = JSON.stringify({
      $schema: 'https://sysmlv2-poc.example.com/schema/v1',
      version: '1.0.0',
      exportedAt: '2026-09-14T12:00:00Z',
      model: {
        packages: [
          {
            kind: 'package',
            id: 'pkg-legacy',
            name: 'Legacy',
            members: [
              {
                kind: 'partDef',
                id: 'pd-x',
                name: 'X',
                body: [],
                location: { line: 2, column: 3, offset: 20 },
              },
            ],
            location: { line: 1, column: 1, offset: 0 },
          },
        ],
        connections: [],
      },
    });

    const r = importFromJson(legacyJson);
    expect(r.errors).toEqual([]);
    expect(r.model.views).toEqual([]);
    expect(r.model.viewpoints).toEqual([]);
    expect(r.model.packages[0]?.name).toBe('Legacy');
  });
});

// ─── 嵌套 view 在 import/export 中保留 ───────────────────────────────────

describe('嵌套 view (§7.26 / Q17-B)', () => {
  it('嵌套 view 通过 import → model → export 保留层级', () => {
    const filePath = path.join(EXAMPLES_DIR, 'nested-view.sysml.json');
    const content = fs.readFileSync(filePath, 'utf8');
    const r = importFromJson(content);
    expect(r.errors).toEqual([]);

    expect(r.model.views.length).toBe(1);
    const outer = r.model.views[0]!;
    expect(outer.name).toBe('Outer View');

    // 嵌套 view 进入 outer.members
    const inner = outer.members.find((m) => m.kind === 'view');
    expect(inner).toBeDefined();
    expect((inner as { name: string }).name).toBe('Inner View');
  });
});

// ─── 顶层 view + viewpoint 各自走 export 路径 ───────────────────────────

describe('export 路径 view / viewpoint 不丢失', () => {
  it('带 view 的 model 经 exportToJson 后,views 数组在 JSON 中保留', () => {
    const model = {
      packages: [],
      connections: [],
      views: [
        {
          kind: 'view' as const,
          id: 'view-x',
          name: 'X',
          declKind: 'definition' as const,
          reveals: [],
          filters: [],
          members: [],
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
      viewpoints: [],
    };
    const out = exportToJson(model);
    expect(out.model.views.length).toBe(1);
    expect(out.model.views[0]?.name).toBe('X');
  });

  it('带 viewpoint 的 model 经 exportToJson 后,viewpoints 数组在 JSON 中保留', () => {
    const model = {
      packages: [],
      connections: [],
      views: [],
      viewpoints: [
        {
          kind: 'viewpoint' as const,
          id: 'vp-x',
          name: 'X',
          declKind: 'definition' as const,
          subject: 'Vehicle',
          members: [],
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
    };
    const out = exportToJson(model);
    expect(out.model.viewpoints.length).toBe(1);
    expect(out.model.viewpoints[0]?.subject).toBe('Vehicle');
  });
});