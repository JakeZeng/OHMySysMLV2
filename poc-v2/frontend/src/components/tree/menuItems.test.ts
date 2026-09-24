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
      'create-element-trigger',
      'rename',
      'delete',
    ]);
  });

  it('view offers open / properties / rename / duplicate / delete', () => {
    expect(ids('view')).toEqual([
      'open-view',
      'view-properties',
      'rename',
      'duplicate-view',
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
    for (const kind of ['package', 'view'] as const) {
      const del = menuItemsFor(kind).find((i) => i.id === 'delete');
      expect(del?.danger).toBe(true);
    }
  });

  it('never marks a non-delete item as dangerous', () => {
    for (const kind of ['project', 'package', 'view', 'element'] as const) {
      const others = menuItemsFor(kind).filter((i) => i.id !== 'delete' && i.id !== 'element-delete');
      expect(others.every((i) => !i.danger)).toBe(true);
    }
  });

  it('gives every item a unique id and a label', () => {
    for (const kind of ['project', 'package', 'view', 'element'] as const) {
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
    const ref = { packageId: 'p1', elementName: 'Part_1' };
    expect(
      actionFor('element-goto-canvas', { kind: 'element', id: 'elem:Part_1', name: 'Part_1' }, ref),
    ).toEqual({ type: 'element-action', action: 'goto-canvas', ref });
  });

  it('element-rename and element-delete route to element-action', () => {
    const ref = { packageId: 'p1', elementName: 'Part_1' };
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
});
