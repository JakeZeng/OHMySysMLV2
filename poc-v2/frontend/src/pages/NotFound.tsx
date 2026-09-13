/**
 * 404 页面。
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const NotFound: React.FC = () => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4 text-center">
      <Compass className="mb-3 h-12 w-12 text-gray-300" />
      <h1 className="text-2xl font-semibold text-gray-900">页面不存在</h1>
      <p className="mt-2 text-sm text-gray-500">
        你访问的页面已被移动或不存在。
      </p>
      <Link to="/" className="mt-6">
        <Button>返回首页</Button>
      </Link>
    </div>
  );
};
