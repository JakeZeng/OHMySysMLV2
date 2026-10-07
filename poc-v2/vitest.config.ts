/**
 * POC v2 根 vitest 配置。
 *
 * 只跑 parser/validator/transform 端的测试（tests/ 目录），
 * 前端测试在 frontend/ 目录下有自己的 vitest run。
 */

import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'frontend/**'],
  },
  resolve: {
    // 强制 .ts 优先于 .js（避免 vitest 拿旧的 build 产物 .js）
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    alias: {
      // 与 frontend/vite.config.ts 同一套别名：core 目录（parser / views / …）
      // 在两端都按 `@x` 引用，避免测试里写相对路径、源码里写别名导致解析不一致。
      '@parser': path.resolve(__dirname, 'parser'),
      '@validator': path.resolve(__dirname, 'validator'),
      '@transform': path.resolve(__dirname, 'transform'),
      '@ast': path.resolve(__dirname, 'ast'),
      '@views': path.resolve(__dirname, 'views'),
    },
  },
});
