/**
 * menuItems.test.ts — M12 右键菜单配置与动作映射
 */

import { describe, it, expect } from 'vitest';
import { menuItemsFor, actionFor } from './menuItems';

const ids = (kind: Parameters<typeof menuItemsFor>[0]) =>
  menuItemsFor(kind).map((i) => i.id);

describe('menuItemsFor', () => {
  it('project root can only create a top-level package', () => {
    expect(ids('project')).toEqual(['create-package']);
  });

  it('package offers create child package / create view / create element / rename / delete', () => {
    expect(ids('package')).toEqual([
      'create-package',
      'create-view',
      'create-viewpoint',
      'create-element-trigger',
      'move-to-top',
      'rename',
      'delete',
    ]);
  });

  it('view (definition) offers open / create-usage / properties / rename / duplicate / delete', () => {
    expect(ids('view')).toEqual([
      'open-view',
      'create-view-usage',
      'view-properties',
      'rename',
      'duplicate-view',
      'delete',
    ]);
  });

  it('view (usage) cannot derive another usage — no create-view-usage item', () => {
    const usageIds = menuItemsFor('view', 'package', 'usage').map((i) => i.id);
    expect(usageIds).not.toContain('create-view-usage');
    expect(usageIds).toEqual([
      'open-view',
      'view-properties',
      'rename',
      'duplicate-view',
      'delete',
    ]);
  });

  it('viewpoint offers properties / rename / delete', () => {
    expect(ids('viewpoint')).toEqual([
      'viewpoint-properties',
      'rename',
      'delete',
    ]);
  });

  it('element offers goto-canvas / rename / delete', () => {
    expect(ids('element')).toEqual([
      'element-goto-canvas',
      'element-rename',
      'element-delete',
    ]);
  });

  it('marks delete as dangerous on both package and view', () => {
    for (const kind of ['package', 'view', 'viewpoint'] as const) {
      const del = menuItemsFor(kind).find((i) => i.id === 'delete');
      expect(del?.danger).toBe(true);
    }
  });

  it('never marks a non-delete item as dangerous', () => {
    for (const kind of ['project', 'package', 'view', 'viewpoint', 'element'] as const) {
      const others = menuItemsFor(kind).filter((i) => i.id !== 'delete' && i.id !== 'element-delete');
      expect(others.every((i) => !i.danger)).toBe(true);
    }
  });

  it('gives every item a unique id and a label', () => {
    for (const kind of ['project', 'package', 'view', 'viewpoint', 'element'] as const) {
      const items = menuItemsFor(kind);
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
      expect(items.every((i) => i.label.length > 0)).toBe(true);
    }
  });
});

describe('actionFor', () => {
  const pkgTarget = { kind: 'package' as const, id: 'p1', name: '结构包' };
  const viewTarget = { kind: 'view' as const, id: 'v1', name: '视图A' };

  it('create-package on a package targets that package as parent', () => {
    expect(actionFor('create-package', pkgTarget)).toEqual({
      type: 'create-package',
      parentPackageId: 'p1',
    });
  });

  it('create-package on the project root creates a top-level package (null parent)', () => {
    expect(
      actionFor('create-package', { kind: 'project', id: 'proj1', name: '工程' }),
    ).toEqual({ type: 'create-package', parentPackageId: null });
  });

  it('create-view on a package targets that package', () => {
    expect(actionFor('create-view', pkgTarget)).toEqual({
      type: 'create-view',
      packageId: 'p1',
    });
  });

  it('rename carries the current name for prefill', () => {
    expect(actionFor('rename', pkgTarget)).toEqual({
      type: 'rename',
      kind: 'package',
      id: 'p1',
      currentName: '结构包',
    });
  });

  it('delete carries the name for the confirm dialog', () => {
    expect(actionFor('delete', viewTarget)).toEqual({
      type: 'delete',
      kind: 'view',
      id: 'v1',
      name: '视图A',
    });
  });

  it('duplicate-view maps to the duplicate action', () => {
    expect(actionFor('duplicate-view', viewTarget)).toEqual({
      type: 'duplicate-view',
      id: 'v1',
      name: '视图A',
    });
  });

  it('view-properties maps to the properties action', () => {
    expect(actionFor('view-properties', viewTarget)).toEqual({
      type: 'view-properties',
      id: 'v1',
    });
  });

  it('open-view produces no action (handled by selection)', () => {
    expect(actionFor('open-view', viewTarget)).toBeNull();
  });

  it('returns null for an unknown menu item id', () => {
    expect(actionFor('nonexistent', pkgTarget)).toBeNull();
  });

  // ── M14 ─────────────────────────────────────────────
  it('create-element-trigger on a package targets that package', () => {
    expect(actionFor('create-element-trigger', pkgTarget)).toEqual({
      type: 'create-element-trigger',
      parentPackageId: 'p1',
    });
  });

  it('element-goto-canvas requires an ElementRef', () => {
    const ref = { ownerId: 'p1', ownerKind: 'package' as const, elementName: 'Part_1' };
    expect(
      actionFor('element-goto-canvas', { kind: 'element', id: 'elem:Part_1', name: 'Part_1' }, ref),
    ).toEqual({ type: 'element-action', action: 'goto-canvas', ref });
  });

  it('element-rename and element-delete route to element-action', () => {
    const ref = { ownerId: 'p1', ownerKind: 'package' as const, elementName: 'Part_1' };
    expect(
      actionFor('element-rename', { kind: 'element', id: 'elem:Part_1', name: 'Part_1' }, ref),
    ).toEqual({ type: 'element-action', action: 'rename', ref });
    expect(
      actionFor('element-delete', { kind: 'element', id: 'elem:Part_1', name: 'Part_1' }, ref),
    ).toEqual({ type: 'element-action', action: 'delete', ref });
  });

  it('element-* on a non-element target falls back to legacy rename/delete', () => {
    expect(actionFor('element-rename', pkgTarget)).toEqual({
      type: 'rename',
      kind: 'package',
      id: 'p1',
      currentName: '结构包',
    });
  });

  // ── M15 ─────────────────────────────────────────────
  it('create-viewpoint on a package targets that package', () => {
    expect(actionFor('create-viewpoint', pkgTarget)).toEqual({
      type: 'create-viewpoint',
      packageId: 'p1',
    });
  });

  it('create-viewpoint on the project root creates a top-level viewpoint', () => {
    expect(
      actionFor('create-viewpoint', { kind: 'project', id: 'proj1', name: '工程' }),
    ).toEqual({ type: 'create-viewpoint', packageId: null });
  });

  it('viewpoint-properties maps to the properties action', () => {
    const vpTarget = { kind: 'viewpoint' as const, id: 'vp1', name: '视角A' };
    expect(actionFor('viewpoint-properties', vpTarget)).toEqual({
      type: 'viewpoint-properties',
      id: 'vp1',
    });
  });

  it('rename on a viewpoint carries kind=viewpoint', () => {
    const vpTarget = { kind: 'viewpoint' as const, id: 'vp1', name: '视角A' };
    expect(actionFor('rename', vpTarget)).toEqual({
      type: 'rename',
      kind: 'viewpoint',
      id: 'vp1',
      currentName: '视角A',
    });
  });

  it('delete on a viewpoint carries kind=viewpoint', () => {
    const vpTarget = { kind: 'viewpoint' as const, id: 'vp1', name: '视角A' };
    expect(actionFor('delete', vpTarget)).toEqual({
      type: 'delete',
      kind: 'viewpoint',
      id: 'vp1',
      name: '视角A',
    });
  });

  // ── M15 §7.26：ViewDefinition → ViewUsage ────────────
  it('create-view-usage carries the target view as the instantiated definition', () => {
    expect(actionFor('create-view-usage', viewTarget)).toEqual({
      type: 'create-view-usage',
      viewDefinitionId: 'v1',
    });
  });

  it('create-view-usage on a non-view target produces no action', () => {
    expect(actionFor('create-view-usage', pkgTarget)).toBeNull();
  });
});
