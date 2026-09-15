/**
 * M3 元模型详情面板
 *
 * 显示选中元素的完整信息：标题、Kind、父类、属性表、子类列表、文档。
 */

import { useMetamodelElement } from './useMetamodel';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

interface MetamodelDetailProps {
  qname: string;
}

export function MetamodelDetail({ qname }: MetamodelDetailProps) {
  const { data, isLoading, error } = useMetamodelElement(qname);

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

  if (!data) {
    return <div className="p-4 text-sm text-gray-500">无数据</div>;
  }

  return (
    <div className="p-4 overflow-y-auto">
      {/* 标题 + 标识 */}
      <h2 className="text-2xl font-bold">{data.name}</h2>
      <div className="text-sm text-gray-500 font-mono mt-1">{data.qname}</div>

      <div className="flex gap-2 mt-2">
        <Badge variant="default">{data.kind}</Badge>
        {data.super_type && (
          <Badge variant="outline">extends {data.super_type}</Badge>
        )}
      </div>

      {/* 文档 */}
      {data.documentation && (
        <p className="mt-3 text-gray-700 text-sm leading-relaxed">
          {data.documentation}
        </p>
      )}

      {/* 属性表 */}
      <h3 className="mt-5 font-semibold text-sm">
        属性 ({data.properties.length})
      </h3>
      {data.properties.length > 0 ? (
        <table className="w-full mt-2 text-sm">
          <thead className="text-xs text-gray-500">
            <tr className="border-b">
              <th className="text-left py-1">Name</th>
              <th className="text-left py-1">Type</th>
              <th className="text-left py-1">Mult</th>
              <th className="text-left py-1">Required</th>
            </tr>
          </thead>
          <tbody>
            {data.properties.map((p) => (
              <tr key={p.name} className="border-b">
                <td className="font-mono py-1">{p.name}</td>
                <td className="font-mono text-blue-600 py-1">{p.type}</td>
                <td className="font-mono py-1">{p.multiplicity}</td>
                <td className="py-1">{p.required ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-sm text-gray-500 mt-1">无属性</div>
      )}

      {/* 子类列表 */}
      {data.sub_types.length > 0 && (
        <>
          <h3 className="mt-5 font-semibold text-sm">
            子类 ({data.sub_types.length})
          </h3>
          <ul className="mt-2 space-y-1">
            {data.sub_types.map((st) => (
              <li
                key={st}
                className={cn(
                  'text-sm font-mono text-blue-600',
                  'hover:underline cursor-pointer'
                )}
              >
                {st}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
