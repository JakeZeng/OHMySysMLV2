/**
 * LocalStorage Hook（持久化状态到 localStorage）
 */

import { useState, useEffect, useCallback } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return initialValue;
      return JSON.parse(stored) as T;
    } catch {
      return initialValue;
    }
  });

  // 写入 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 忽略写入错误（quota 等）
    }
  }, [key, value]);

  const setValueAndStore = useCallback((newValue: T) => {
    setValue(newValue);
  }, []);

  return [value, setValueAndStore];
}