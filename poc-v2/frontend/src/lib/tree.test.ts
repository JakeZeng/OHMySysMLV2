/**
 * tree.test.ts — M12 工程树纯逻辑（buildTree / visibleRows / 查找）
 */

import { describe, it, expect } from 'vitest';
import {
  buildTree,
  visibleRows,
  findNode,
  findNodePath,
  ancestorsToExpand,
  type TreeNode,
} from './tree';
import type { PackageSummary } from '../types/package';
import type { ViewSummary } from '../types/view';

function pkg(
  id: string,
  name: string,
  parentPackageId = '',
): PackageSummary {
  return {
    id,
    projectId: 'proj1',
    parentPackageId,
    name,
    description: '',
    version: 1,
    updatedAt: '2026-09-23T00:00:00Z',
  };
}

function view(id: string, name: string, packageId = '', colorTag?: string): ViewSummary {
  return {
    id,
    projectId: 'proj1',
    packageId,
    name,
    description: '',
    colorTag,
    version: 1,
    updatedAt: '2026-09-23T00:00:00Z',
  };
}

const base = {
  projectId: 'proj1',
  projectName: '无人机工程',
};

/** 便捷断言：某节点的子节点名字序列 */
function childNames(node: TreeNode): string[] {
  return node.children.map((c) => c.name);
}

describe('buildTree', () => {
  it('creates a project root carrying the project name', () => {
    const root = buildTree({ ...base, packages: [], views: [] });
    expect(root.kind).toBe('project');
    expect(root.encodedId).toBe('project:proj1');
    expect(root.name).toBe('无人机工程');
    expect(root.children).toEqual([]);
  });

  it('places top-level packages (empty parentPackageId) directly under root', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '结构包'), pkg('p2', '需求包')],
      views: [],
    });
    expect(childNames(root)).toEqual(['结构包', '需求包']);
    expect(root.children[0].kind).toBe('package');
    expect(root.children[0].encodedId).toBe('pkg:p1');
  });

  it('nests sub-packages under their parent package', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '结构包'), pkg('p2', '动力子包', 'p1')],
      views: [],
    });
    expect(childNames(root)).toEqual(['结构包']);
    expect(childNames(root.children[0])).toEqual(['动力子包']);
  });

  it('nests views under their package', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '结构包')],
      views: [view('v1', 'Vehicle 结构视图', 'p1')],
    });
    expect(childNames(root.children[0])).toEqual(['Vehicle 结构视图']);
    expect(root.children[0].children[0].encodedId).toBe('view:v1');
  });

  it('orders packages before views within the same parent', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '结构包'), pkg('p2', '子包', 'p1')],
      // 视图在列表里排在包前面，仍应渲染在包之后
      views: [view('v1', '视图A', 'p1')],
    });
    expect(childNames(root.children[0])).toEqual(['子包', '视图A']);
  });

  it('keeps root-level views (empty packageId) under the project root', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '结构包')],
      views: [view('v1', '全局视图', '')],
    });
    expect(childNames(root)).toEqual(['结构包', '全局视图']);
  });

  it('carries the view colorTag through to the node', () => {
    const root = buildTree({
      ...base,
      packages: [],
      views: [view('v1', '视图A', '', '#1890ff')],
    });
    expect(root.children[0].colorTag).toBe('#1890ff');
  });

  it('re-parents a package whose parent is missing to the root (no data loss)', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '孤儿包', 'ghost')],
      views: [],
    });
    expect(childNames(root)).toEqual(['孤儿包']);
  });

  it('re-parents a view whose package is missing to the root (no data loss)', () => {
    const root = buildTree({
      ...base,
      packages: [],
      views: [view('v1', '孤儿视图', 'ghost')],
    });
    expect(childNames(root)).toEqual(['孤儿视图']);
  });

  it('breaks parent cycles without hanging or dropping nodes', () => {
    const root = buildTree({
      ...base,
      // A → B → A 互相为父
      packages: [pkg('a', 'A', 'b'), pkg('b', 'B', 'a')],
      views: [],
    });
    const all = visibleRows(root, new Set([
      root.encodedId,
      'pkg:a',
      'pkg:b',
    ])).map((r) => r.node.name);
    expect(all).toContain('A');
    expect(all).toContain('B');
    // 环被打断：A 只出现一次
    expect(all.filter((n) => n === 'A')).toHaveLength(1);
  });

  it('handles three-level nesting', () => {
    const root = buildTree({
      ...base,
      packages: [
        pkg('p1', 'L1'),
        pkg('p2', 'L2', 'p1'),
        pkg('p3', 'L3', 'p2'),
      ],
      views: [],
    });
    expect(root.children[0].children[0].children[0].name).toBe('L3');
  });
});

describe('visibleRows', () => {
  const root = buildTree({
    ...base,
    packages: [pkg('p1', '结构包'), pkg('p2', '子包', 'p1')],
    views: [view('v1', '视图A', 'p1')],
  });

  it('shows only the root when nothing is expanded', () => {
    const rows = visibleRows(root, new Set());
    expect(rows.map((r) => r.node.name)).toEqual(['无人机工程']);
    expect(rows[0].depth).toBe(0);
  });

  it('shows top-level children when only the root is expanded', () => {
    const rows = visibleRows(root, new Set(['project:proj1']));
    expect(rows.map((r) => r.node.name)).toEqual(['无人机工程', '结构包']);
  });

  it('requires every ancestor to be expanded for deep rows to appear', () => {
    const rows = visibleRows(root, new Set(['project:proj1', 'pkg:p1']));
    expect(rows.map((r) => r.node.name)).toEqual([
      '无人机工程',
      '结构包',
      '子包',
      '视图A',
    ]);
  });

  it('assigns depth by nesting level', () => {
    const rows = visibleRows(root, new Set(['project:proj1', 'pkg:p1']));
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2]);
  });

  it('hides a subtree when its parent is collapsed even if children are marked expanded', () => {
    // pkg:p1 未展开，pkg:p2 已展开 → p2 不可见
    const rows = visibleRows(root, new Set(['project:proj1', 'pkg:p2']));
    expect(rows.map((r) => r.node.name)).toEqual(['无人机工程', '结构包']);
  });
});

describe('findNode / findNodePath / ancestorsToExpand', () => {
  const root = buildTree({
    ...base,
    packages: [pkg('p1', '结构包'), pkg('p2', '子包', 'p1')],
    views: [view('v1', '视图A', 'p2')],
  });

  it('findNode returns the node by encoded id', () => {
    expect(findNode(root, 'view:v1')?.name).toBe('视图A');
    expect(findNode(root, 'pkg:p2')?.name).toBe('子包');
  });

  it('findNode returns null for an unknown id', () => {
    expect(findNode(root, 'pkg:nope')).toBeNull();
    expect(findNode(root, 'view:nope')).toBeNull();
  });

  it('findNodePath returns the full ancestor chain including the node', () => {
    const path = findNodePath(root, 'view:v1');
    expect(path.map((n) => n.name)).toEqual(['无人机工程', '结构包', '子包', '视图A']);
  });

  it('findNodePath returns [] when not found', () => {
    expect(findNodePath(root, 'pkg:ghost')).toEqual([]);
  });

  it('ancestorsToExpand excludes the node itself', () => {
    expect(ancestorsToExpand(root, 'view:v1')).toEqual([
      'project:proj1',
      'pkg:p1',
      'pkg:p2',
    ]);
  });

  it('ancestorsToExpand for the root is empty', () => {
    expect(ancestorsToExpand(root, 'project:proj1')).toEqual([]);
  });
});

// ── M14：元素节点（packageElements） ──────────────────────────────

describe('buildTree with packageElements (M14)', () => {
  it('attaches element nodes under their parent package', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '结构包')],
      views: [],
      packageElements: {
        p1: [
          { name: 'Part_1', kind: 'partDef' },
          { name: 'Port_1', kind: 'portDef' },
        ],
      },
    });
    const p1 = root.children.find((c) => c.kind === 'package')!;
    expect(p1.children.map((c) => `${c.kind}:${c.name}`)).toEqual([
      'element:Part_1',
      'element:Port_1',
    ]);
    expect(p1.children[0].elementKind).toBe('partDef');
    expect(p1.children[0].parentId).toBe('p1');
  });

  it('orders children: package → element → view', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '结构包'), pkg('p2', '子包', 'p1')],
      views: [view('v1', '视图A', 'p1')],
      packageElements: {
        p1: [{ name: 'Part_1', kind: 'partDef' }],
      },
    });
    const p1 = root.children.find((c) => c.kind === 'package' && c.id === 'p1')!;
    expect(p1.children.map((c) => c.kind)).toEqual(['package', 'element', 'view']);
  });

  it('ignores element entries for unknown package ids', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '结构包')],
      views: [],
      packageElements: {
        ghost: [{ name: 'Part_1', kind: 'partDef' }],
        p1: [{ name: 'Part_2', kind: 'partDef' }],
      },
    });
    const p1 = root.children.find((c) => c.kind === 'package')!;
    expect(p1.children).toHaveLength(1);
    expect(p1.children[0].name).toBe('Part_2');
  });

  it('element nodes have empty children array (leaf)', () => {
    const root = buildTree({
      ...base,
      packages: [pkg('p1', '结构包')],
      views: [],
      packageElements: { p1: [{ name: 'Part_1', kind: 'partDef' }] },
    });
    const el = root.children[0].children[0];
    expect(el.children).toEqual([]);
  });
});
