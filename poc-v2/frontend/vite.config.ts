import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 强制 .ts 优先于 .js，避免 Vite 抓到旧 build 产物 .js
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 工具目录（parser/ validator/ transform/ ast/）是 poc-v2/ 的同级子目录。
      // Docker build 时 WORKDIR=/build，alias `../parser` 解析为 /parser/，
      // 与 Dockerfile 的 `COPY parser/ ../parser/` 一致。
      // 本地 dev（npm run dev）从 poc-v2/frontend/ 跑，`../parser` 解析为
      // poc-v2/parser/，与原来一致 → 不用动 host 任何东西。
      '@parser': path.resolve(__dirname, '../parser'),
      '@validator': path.resolve(__dirname, '../validator'),
      '@transform': path.resolve(__dirname, '../transform'),
      '@ast': path.resolve(__dirname, '../ast'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  // 关键：把 parser.generated.js 当成原生 ESM，不要经过 esbuild 优化
  optimizeDeps: {
    exclude: ['parser.generated.js'],
  },
});
