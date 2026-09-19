/**
 * 国际化 Hook
 */

import { useCallback } from 'react';
import { useLocalStorage } from '../lib/useLocalStorage';
import { translations, type Language } from './translations';

export function useI18n() {
  const [language, setLanguage] = useLocalStorage<Language>('app_language', 'zh');

  // 简单嵌套键路径解析器（a.b.c）
  const translate = useCallback(
    (key: string): string => {
      const keys = key.split('.');
      let value: unknown = translations[language];
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = (value as Record<string, unknown>)[k];
        } else {
          // 回退到中文
          let fallback: unknown = translations.zh;
          for (const fk of keys) {
            if (fallback && typeof fallback === 'object' && fk in fallback) {
              fallback = (fallback as Record<string, unknown>)[fk];
            } else {
              return key; // 找不到返回 key
            }
          }
          return typeof fallback === 'string' ? fallback : key;
        }
      }
      return typeof value === 'string' ? value : key;
    },
    [language]
  );

  // 简写：t('common.save')
  const t = translate;

  return {
    language,
    setLanguage,
    t,
    isZh: language === 'zh',
    isEn: language === 'en',
  };
}