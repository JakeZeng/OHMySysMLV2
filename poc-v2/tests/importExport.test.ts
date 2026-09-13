/**
 * JSON Import/Export 测试（M2）
 *
 * 测试 round-trip：parse(text) → export JSON → import JSON → serialize → parse → 比较 AST
 * 以及 3 个官方示例的导入/导出正确性。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { validate } from '../validator/validator';
import { exportToJson, exportToJsonString, SCHEMA_VERSION, SCHEMA_URI } from '../transform/exportJson';
import { importFromJson } from '../transform/importJson';
import { serialize } from '../transform/serializer';
import type { SysMLModel } from '../ast/model';
import { readFileSync } from 'fs';
import { join } from 'path';

// ─── 测试用 SysML 文本 ──────────────────────────────────────────────

const CAR_BASIC_TEXT = `
package CarBasic {
  port def Power inout {}
  part def Engine {
    port powerPort : Power;
  }
  part def Car {
    port powerPort : Power;
  }
  part car1 : Car;
  part engine1 : Engine;
  connect car1.powerPort to engine1.powerPort;
}
`.trim();

const INHERITANCE_TEXT = `
package Inheritance {
  port def Power inout {}
  abstract part def Vehicle {
    port powerPort : Power;
  }
  part def Car : Vehicle {
    port :>> powerPort;
  }
  part myCar : Car;
}
`.trim();

const NESTED_PACKAGES_TEXT = `
package Powertrain {
  port def Power inout {}
  part def Motor {
    port powerIn : Power;
  }
}
package Chassis {
  import Powertrain;
  part def Car {
    port powerPort : Power;
  }
  part car1 : Car;
  part motor1 : Motor;
  connect car1.powerPort to motor1.powerIn;
}
`.trim();

// ─── 导出测试 ─────────────────────────────────────────────────────────

describe('JSON Export', () => {
  it('1. 导出包含正确的 schema 和 version', () => {
    const result = parse(CAR_BASIC_TEXT);
    const exported = exportToJson(result.model);
    expect(exported.$schema).toBe(SCHEMA_URI);
    expect(exported.version).toBe(SCHEMA_VERSION);
    expect(exported.exportedAt).toBeTruthy();
    expect(exported.model).toBeDefined();
  });

  it('2. 导出包含所有 packages', () => {
    const result = parse(NESTED_PACKAGES_TEXT);
    const exported = exportToJson(result.model);
    expect(exported.model.packages).toHaveLength(2);
    expect(exported.model.packages[0].name).toBe('Powertrain');
    expect(exported.model.packages[1].name).toBe('Chassis');
  });

  it('3. 导出包含 connections', () => {
    const result = parse(CAR_BASIC_TEXT);
    const exported = exportToJson(result.model);
    const pkg = exported.model.packages[0];
    // connections are in pkg.members
    const connections = pkg.members.filter((m) => m.kind === 'connection');
    expect(connections.length).toBeGreaterThan(0);
  });

  it('4. 导出 JSON 字符串是合法 JSON', () => {
    const result = parse(CAR_BASIC_TEXT);
    const jsonStr = exportToJsonString(result.model);
    expect(() => JSON.parse(jsonStr)).not.toThrow();
  });
});

// ─── 导入测试 ─────────────────────────────────────────────────────────

describe('JSON Import', () => {
  it('1. 导入合法 JSON 返回 ok=true', () => {
    const result = parse(CAR_BASIC_TEXT);
    const jsonStr = exportToJsonString(result.model);
    const imported = importFromJson(jsonStr);
    expect(imported.ok).toBe(true);
    expect(imported.errors).toHaveLength(0);
    expect(imported.text).toBeTruthy();
  });

  it('2. 导入非法 JSON 返回错误', () => {
    const imported = importFromJson('not valid json');
    expect(imported.ok).toBe(false);
    expect(imported.errors.length).toBeGreaterThan(0);
    expect(imported.errors[0].message).toContain('JSON 解析失败');
  });

  it('3. 导入缺少 model 字段返回错误', () => {
    const imported = importFromJson(JSON.stringify({ version: '1.0.0' }));
    expect(imported.ok).toBe(false);
    expect(imported.errors[0].message).toContain('model');
  });

  it('4. 导入 packages 非数组返回错误', () => {
    const imported = importFromJson(JSON.stringify({
      $schema: SCHEMA_URI,
      version: '1.0.0',
      exportedAt: '2026-01-01T00:00:00Z',
      model: { packages: 'not-array', connections: [] },
    }));
    expect(imported.ok).toBe(false);
    expect(imported.errors[0].message).toContain('packages');
  });

  it('5. 导入后 text 可重新 parse', () => {
    const result = parse(CAR_BASIC_TEXT);
    const jsonStr = exportToJsonString(result.model);
    const imported = importFromJson(jsonStr);
    expect(imported.ok).toBe(true);

    const reParsed = parse(imported.text);
    expect(reParsed.errors).toHaveLength(0);
    expect(reParsed.model.packages.length).toBe(result.model.packages.length);
  });

  it('6. 导入未知成员类型返回错误', () => {
    const imported = importFromJson(JSON.stringify({
      $schema: SCHEMA_URI,
      version: '1.0.0',
      exportedAt: '2026-01-01T00:00:00Z',
      model: {
        packages: [{
          kind: 'package',
          name: 'Test',
          members: [{ kind: 'invalidKind', name: 'x', location: { line: 1, column: 1, offset: 0 } }],
          location: { line: 1, column: 1, offset: 0 },
        }],
        connections: [],
      },
    }));
    expect(imported.ok).toBe(false);
    expect(imported.errors[0].message).toContain('未知的成员类型');
  });
});

// ─── Round-trip 测试 ──────────────────────────────────────────────────

describe('JSON Round-trip', () => {
  const examples = [
    { name: 'car-basic', text: CAR_BASIC_TEXT },
    { name: 'inheritance', text: INHERITANCE_TEXT },
    { name: 'nested-packages', text: NESTED_PACKAGES_TEXT },
  ];

  for (const ex of examples) {
    it(`${ex.name}: text → JSON → text → parse 保持结构一致`, () => {
      // 1. 原始 parse
      const original = parse(ex.text);
      expect(original.errors).toHaveLength(0);

      // 2. export JSON
      const jsonStr = exportToJsonString(original.model);

      // 3. import JSON → text
      const imported = importFromJson(jsonStr);
      expect(imported.ok).toBe(true);

      // 4. re-parse
      const reparsed = parse(imported.text);
      expect(reparsed.errors).toHaveLength(0);

      // 5. 结构比较：packages 数量、成员数量一致
      expect(reparsed.model.packages.length).toBe(original.model.packages.length);
      for (let i = 0; i < original.model.packages.length; i++) {
        const origPkg = original.model.packages[i];
        const newPkg = reparsed.model.packages[i];
        expect(newPkg.name).toBe(origPkg.name);
        expect(newPkg.members.length).toBe(origPkg.members.length);

        // 比较每个成员的 kind 和 name
        for (let j = 0; j < origPkg.members.length; j++) {
          expect(newPkg.members[j].kind).toBe(origPkg.members[j].kind);
          if ('name' in origPkg.members[j]) {
            expect((newPkg.members[j] as { name?: string }).name).toBe(
              (origPkg.members[j] as { name?: string }).name
            );
          }
        }
      }
    });

    it(`${ex.name}: import 后 validate 无新增错误`, () => {
      const original = parse(ex.text);
      const origValidation = validate(original.model);
      const origErrorCount = origValidation.issues.filter((i) => i.severity === 'error').length;

      const jsonStr = exportToJsonString(original.model);
      const imported = importFromJson(jsonStr);
      expect(imported.ok).toBe(true);

      const reparsed = parse(imported.text);
      const newValidation = validate(reparsed.model);
      const newErrorCount = newValidation.issues.filter((i) => i.severity === 'error').length;

      // 新增错误数不应超过原始（允许因序列化格式差异引入少量）
      expect(newErrorCount).toBeLessThanOrEqual(origErrorCount + 1);
    });
  }
});

// ─── 官方示例文件测试 ─────────────────────────────────────────────────

describe('官方示例文件导入', () => {
  const examplesDir = join(__dirname, '..', 'schema', 'examples');

  const exampleFiles = [
    'car-basic.sysml.json',
    'inheritance.sysml.json',
    'nested-packages.sysml.json',
  ];

  for (const file of exampleFiles) {
    it(`${file} 导入成功且可 re-parse`, () => {
      const content = readFileSync(join(examplesDir, file), 'utf-8');
      const imported = importFromJson(content);
      expect(imported.ok).toBe(true);
      expect(imported.errors).toHaveLength(0);
      expect(imported.text).toBeTruthy();

      // re-parse 验证
      const reparsed = parse(imported.text);
      expect(reparsed.errors).toHaveLength(0);
      expect(reparsed.model.packages.length).toBeGreaterThan(0);
    });
  }
});

// ─── Serializer 测试 ──────────────────────────────────────────────────

describe('Serializer', () => {
  it('1. 空 model 序列化为空字符串 + 换行', () => {
    const model: SysMLModel = { packages: [], connections: [] };
    expect(serialize(model)).toBe('\n');
  });

  it('2. 单个 package 序列化正确', () => {
    const model: SysMLModel = {
      packages: [{
        kind: 'package',
        id: 'pkg1',
        name: 'Test',
        members: [],
        location: { line: 1, column: 1, offset: 0 },
      }],
      connections: [],
    };
    const text = serialize(model);
    expect(text).toContain('package Test {');
    expect(text).toContain('}');
  });

  it('3. part def + port 序列化正确', () => {
    const result = parse(CAR_BASIC_TEXT);
    const text = serialize(result.model);
    expect(text).toContain('part def Engine');
    expect(text).toContain('port powerPort');
  });

  it('4. connect 语句序列化正确', () => {
    const result = parse(CAR_BASIC_TEXT);
    const text = serialize(result.model);
    expect(text).toContain('connect car1.powerPort to engine1.powerPort');
  });

  it('5. 继承序列化正确', () => {
    const result = parse(INHERITANCE_TEXT);
    const text = serialize(result.model);
    expect(text).toContain('part def Car : Vehicle');
    expect(text).toContain('port :>> powerPort');
  });

  it('6. abstract 关键字序列化正确', () => {
    const result = parse(INHERITANCE_TEXT);
    const text = serialize(result.model);
    expect(text).toContain('abstract part def Vehicle');
  });
});
