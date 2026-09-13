/**
 * SysML v2 JSON Export
 *
 * 将 SysMLModel (AST) 导出为标准 JSON 格式。
 * JSON 结构与 AST 一致，附加 $schema 版本信息。
 *
 * 用途：
 *   - 用户下载 JSON 文件
 *   - round-trip 测试（export → import → compare）
 */

import type { SysMLModel } from '../ast/model';

export const SCHEMA_VERSION = '1.0.0';
export const SCHEMA_URI = 'https://sysmlv2-poc.example.com/schema/v1';

export interface SysMLJsonExport {
  $schema: string;
  version: string;
  exportedAt: string;
  model: SysMLModel;
}

/**
 * 导出 SysMLModel 为 JSON 对象。
 */
export function exportToJson(model: SysMLModel): SysMLJsonExport {
  return {
    $schema: SCHEMA_URI,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    model: JSON.parse(JSON.stringify(model)) as SysMLModel,
  };
}

/**
 * 导出 SysMLModel 为格式化 JSON 字符串。
 */
export function exportToJsonString(model: SysMLModel): string {
  return JSON.stringify(exportToJson(model), null, 2);
}

/**
 * 触发浏览器下载 JSON 文件。
 */
export function downloadJson(model: SysMLModel, filename: string = 'model.sysml.json'): void {
  const json = exportToJsonString(model);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
