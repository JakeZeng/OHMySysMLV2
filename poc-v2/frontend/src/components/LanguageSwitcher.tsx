/**
 * 语言切换器
 */

import * as React from 'react';
import { Languages } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { cn } from '../lib/utils';

export const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage } = useI18n();

  return (
    <div className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
      <button
        onClick={() => setLanguage('zh')}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition',
          language === 'zh'
            ? 'bg-brand-500 text-white'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
        )}
        title="中文"
        data-testid="lang-zh"
      >
        🇨🇳 中
      </button>
      <button
        onClick={() => setLanguage('en')}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition',
          language === 'en'
            ? 'bg-brand-500 text-white'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
        )}
        title="English"
        data-testid="lang-en"
      >
        🇺🇸 EN
      </button>
    </div>
  );
};