/**
 * elementFormSchema.test.ts — 表单 schema 字段映射测试
 */

import { describe, it, expect } from 'vitest';
import { schemaFor, SCHEMAS } from './elementFormSchema';

describe('elementFormSchema', () => {
  it('schemaFor returns Part Def schema for sysmlPartDef', () => {
    const s = schemaFor('sysmlPartDef');
    expect(s.title).toContain('Part Def');
    const basic = s.sections.find((x) => x.key === 'basic')!;
    expect(basic.fields.map((f) => f.key)).toContain('name');
    expect(basic.fields.map((f) => f.key)).toContain('isAbstract');
    expect(basic.fields.map((f) => f.key)).toContain('typeRef');
  });

  it('schemaFor returns Part Usage schema for sysmlPartUsage', () => {
    const s = schemaFor('sysmlPartUsage');
    const basic = s.sections.find((x) => x.key === 'basic')!;
    expect(basic.fields.map((f) => f.key)).toEqual(['name', 'typeRef']);
  });

  it('schemaFor returns State schema with isInitial/isFinal', () => {
    const s = schemaFor('sysmlState');
    const basic = s.sections.find((x) => x.key === 'basic')!;
    expect(basic.fields.map((f) => f.key)).toContain('isInitial');
    expect(basic.fields.map((f) => f.key)).toContain('isFinal');
  });

  it('schemaFor returns Requirement schema with reqId and text', () => {
    const s = schemaFor('sysmlRequirement');
    const basic = s.sections.find((x) => x.key === 'basic')!;
    expect(basic.fields.map((f) => f.key)).toContain('reqId');
    const descSection = s.sections.find((x) => x.key === 'description')!;
    expect(descSection.fields.map((f) => f.key)).toContain('text');
  });

  it('schemaFor returns Constraint schema with constraint field', () => {
    const s = schemaFor('sysmlConstraint');
    const descSection = s.sections.find((x) => x.key === 'description')!;
    expect(descSection.fields.map((f) => f.key)).toContain('constraint');
  });

  it('schemaFor falls back to Part Def schema for unknown nodeType', () => {
    const s = schemaFor('unknown');
    expect(s.title).toContain('Part Def');
  });

  it('all 7 node types have schemas', () => {
    const required = [
      'sysmlPartDef', 'sysmlPartUsage', 'sysmlPortDef',
      'sysmlState', 'sysmlAction', 'sysmlRequirement', 'sysmlConstraint',
    ];
    for (const t of required) {
      expect(SCHEMAS[t]).toBeDefined();
      expect(SCHEMAS[t].sections.length).toBeGreaterThan(0);
    }
  });
});