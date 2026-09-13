/**
 * POC v2 根 vitest 配置。
 *
 * 只跑 parser/validator/transform 端的测试（tests/ 目录），
 * 前端测试在 frontend/ 目录下有自己的 vitest run。
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'frontend/**'],
  },
});
