/**
 * 面包屑导航组件（M4.5 增量）。
 *
 * 显示当前页面在应用层级中的位置。
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  to?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
  return (
    <nav className="mb-4 flex items-center gap-1 text-xs text-gray-500" data-testid="breadcrumb">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight className="h-3 w-3 text-gray-400" />}
          {item.to ? (
            <Link to={item.to} className="hover:text-gray-700 hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-900">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};
