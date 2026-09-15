/**
 * M3 元模型树形列表
 *
 * 按 Kind 分组（6 类），点击元素触发 onSelect。
 * 搜索过滤：substring 匹配 element.name。
 */

import { useMemo } from 'react';
import { useMetamodelElements } from './useMetamodel';
import type { MetaElementSummary, ElementKind } from './types';
import { ELEMENT_KINDS, KIND_DISPLAY_NAME } from './types';
import { cn } from '@/lib/utils';

interface MetamodelTreeProps {
  searchQuery: string;
  selectedQname: string | null;
  onSelect: (qname: string) => void;
}

export function MetamodelTree({ searchQuery, selectedQname, onSelect }: MetamodelTreeProps) {
  const { data, isLoading, error } = useMetamodelElements();

  const filtered = useMemo(() => {
    if (!data) return [];
    const lower = searchQuery.toLowerCase();
    return data.elements.filter(
      (e) => !lower || e.name.toLowerCase().includes(lower) || e.qname.toLowerCase().includes(lower)
    );
  }, [data, searchQuery]);

  const grouped = useMemo(() => {
    const map = new Map<ElementKind, MetaElementSummary[]>();
    for (const e of filtered) {
      const kind = e.kind as ElementKind;
      if (!map.has(kind)) map.set(kind, []);
      map.get(kind)!.push(e);
    }
    return map;
  }, [filtered]);

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-500">加载中...</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500">
        加载失败: {(error as Error).message}
      </div>
    );
  }

  if (filtered.length === 0) {
    return <div className="p-4 text-sm text-gray-500">无匹配元素</div>;
  }

  return (
    <div className="overflow-y-auto">
      {ELEMENT_KINDS.map((kind) => {
        const items = grouped.get(kind) || [];
        if (items.length === 0) return null;
        return (
          <details key={kind} open className="border-b">
            <summary className="px-3 py-2 bg-gray-50 cursor-pointer text-sm font-medium">
              {KIND_DISPLAY_NAME[kind]} ({items.length})
            </summary>
            <ul>
              {items.map((e) => (
                <li
                  key={e.qname}
                  onClick={() => onSelect(e.qname)}
                  className={cn(
                    'px-4 py-1.5 text-sm cursor-pointer hover:bg-blue-50',
                    selectedQname === e.qname && 'bg-blue-100 font-medium'
                  )}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      onSelect(e.qname);
                    }
                  }}
                  aria-label={`选择 ${e.name}`}
                >
                  {e.name}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
