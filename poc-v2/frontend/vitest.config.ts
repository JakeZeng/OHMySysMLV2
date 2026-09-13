import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@parser': path.resolve(__dirname, '../parser'),
      '@validator': path.resolve(__dirname, '../validator'),
      '@transform': path.resolve(__dirname, '../transform'),
      '@ast': path.resolve(__dirname, '../ast'),
    },
  },
});
