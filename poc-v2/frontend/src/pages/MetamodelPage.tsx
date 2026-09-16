/**
 * M3 元模型浏览页面。
 *
 * 复用 MetamodelBrowser 主组件，外面包 AppLayout 拿到侧边栏 + 头部。
 */

import * as React from 'react';
import { MetamodelBrowser } from '../metamodel/MetamodelBrowser';

export const MetamodelPage: React.FC = () => {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b bg-white">
        <h1 className="text-lg font-semibold">SysML v2 元模型浏览器</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          浏览 SysML v2 核心元素（Block、Part、Port、Action 等）的定义、父子类关系和文档。
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <MetamodelBrowser />
      </div>
    </div>
  );
};
