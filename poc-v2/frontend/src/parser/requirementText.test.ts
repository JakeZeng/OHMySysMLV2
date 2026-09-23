/**
 * Parser 单元测试：requirement def 的多种语法形式。
 *
 * 重点验证 ReqText 在中间只含注释/空白时也能正确解析（fix m11.x）。
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../../../parser/parser';

describe('RequirementDef text parsing', () => {
  it('parses plain requirement def without text', () => {
    const r = parse('requirement def BrakeReq;');
    expect(r.errors).toEqual([]);
    expect(r.model.requirements).toHaveLength(1);
    expect(r.model.requirements[0]).toMatchObject({ kind: 'requirement', name: 'BrakeReq' });
    expect(r.model.requirements[0].text).toBeUndefined();
  });

  it('parses requirement def with id only', () => {
    const r = parse('requirement def BrakeReq ( REQ-001 );');
    expect(r.errors).toEqual([]);
    expect(r.model.requirements[0]).toMatchObject({
      kind: 'requirement',
      name: 'BrakeReq',
      reqId: 'REQ-001',
    });
  });

  it('parses requirement def with text containing only comment', () => {
    const r = parse('requirement def BrakeReq { /* 制动距离需求 */ };');
    expect(r.errors).toEqual([]);
    expect(r.model.requirements[0].text).toBe('/* 制动距离需求 */');
  });

  it('parses requirement def with plain text', () => {
    const r = parse('requirement def SpeedReq { max speed 200 km/h };');
    expect(r.errors).toEqual([]);
    expect(r.model.requirements[0].text).toBe('max speed 200 km/h');
  });

  it('parses requirement def with id and text', () => {
    const r = parse('requirement def X  ( REQ-1 ) { /* doc */ };');
    expect(r.errors).toEqual([]);
    expect(r.model.requirements[0]).toMatchObject({
      name: 'X',
      reqId: 'REQ-1',
      text: '/* doc */',
    });
  });
});