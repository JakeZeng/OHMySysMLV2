/**
 * M3 元模型搜索框
 *
 * debounce 300ms 避免每次按键都触发请求
 */

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';

interface MetamodelSearchProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

export function MetamodelSearch({ onSearch, placeholder = '搜索元素（不区分大小写）' }: MetamodelSearchProps) {
  const [value, setValue] = useState('');

  // 简单 debounce（300ms）
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(value.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [value, onSearch]);

  return (
    <div className="p-2 border-b">
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="元模型搜索"
      />
    </div>
  );
}
