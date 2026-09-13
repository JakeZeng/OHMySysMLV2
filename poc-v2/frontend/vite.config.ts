import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
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
