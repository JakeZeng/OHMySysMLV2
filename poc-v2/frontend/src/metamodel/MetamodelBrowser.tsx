/**
 * M3 元模型浏览器主组件
 *
 * 设计稿: m3-metamodel-ui.md §3.1
 * - 左侧：搜索框 + 树形列表
 * - 右侧：详情面板
 *
 * 不引入新依赖：复用 @radix-ui + tailwind + 现有 components/ui
 */

import { useState } from 'react';
import { MetamodelSearch } from './MetamodelSearch';
import { MetamodelTree } from './MetamodelTree';
import { MetamodelDetail } from './MetamodelDetail';

interface MetamodelBrowserProps {
  // 无 props：组件自包含
}

export function MetamodelBrowser(_props: MetamodelBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedQname, setSelectedQname] = useState<string | null>(null);

  return (
    <div className="metamodel-browser flex h-full" data-testid="metamodel-browser">
      {/* 左：搜索 + 树形 */}
      <div className="w-1/3 border-r overflow-y-auto" data-testid="metamodel-tree-panel">
        <MetamodelSearch onSearch={setSearchQuery} />
        <MetamodelTree
          searchQuery={searchQuery}
          selectedQname={selectedQname}
          onSelect={setSelectedQname}
        />
      </div>

      {/* 右：详情面板 */}
      <div className="flex-1 overflow-y-auto" data-testid="metamodel-detail-panel">
        {selectedQname ? (
          <MetamodelDetail qname={selectedQname} />
        ) : (
          <div className="p-4 text-sm text-gray-500">选择左侧元素查看详情</div>
        )}
      </div>
    </div>
  );
}
