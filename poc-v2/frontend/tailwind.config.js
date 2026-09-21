/** @type {import('tailwindcss').Config} */
export default {
  // M9.x 修复：启用 class 策略，让 useThemeStore() 通过给 <html> 切换 .dark 类
  // 真正驱动 dark:* 变体（默认 media 策略会被 OS 偏好覆盖，无法手动切换）。
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
