/**
 * M3 元模型 TanStack Query hooks
 *
 * 设计稿: m3-metamodel-ui.md §3.5
 * - useMetamodelElements: 列表
 * - useMetamodelElement: 单个详情
 * - useMetamodelSearch: 模糊搜索
 *
 * staleTime 元模型 5 分钟（不常变），搜索 30 秒（结果可能多版本）。
 */

import { useQuery } from '@tanstack/react-query';
import { metamodelApi } from './api';
import type { ElementKind } from './types';

const STALE_TIME_LONG = 5 * 60 * 1000;  // 5 min
const STALE_TIME_SHORT = 30 * 1000;      // 30 sec

export function useMetamodelElements(kind?: ElementKind) {
  return useQuery({
    queryKey: ['metamodel', 'elements', kind ?? 'all'],
    queryFn: () => metamodelApi.listElements(kind),
    staleTime: STALE_TIME_LONG,
  });
}

export function useMetamodelElement(qname: string | null | undefined) {
  return useQuery({
    queryKey: ['metamodel', 'element', qname],
    queryFn: () => metamodelApi.getElement(qname!),
    enabled: !!qname,
    staleTime: STALE_TIME_LONG,
  });
}

export function useMetamodelSearch(query: string) {
  return useQuery({
    queryKey: ['metamodel', 'search', query],
    queryFn: () => metamodelApi.search(query),
    enabled: query.length >= 1,
    staleTime: STALE_TIME_SHORT,
  });
}

export function useMetamodelSubTypes(qname: string | null | undefined) {
  return useQuery({
    queryKey: ['metamodel', 'subtypes', qname],
    queryFn: () => metamodelApi.getSubTypes(qname!),
    enabled: !!qname,
    staleTime: STALE_TIME_LONG,
  });
}
