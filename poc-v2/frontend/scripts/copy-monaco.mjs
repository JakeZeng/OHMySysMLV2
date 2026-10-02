#!/usr/bin/env node
/**
 * copy-monaco.mjs — 把已安装的 monaco-editor 静态文件复制到 public/monaco/
 *
 * 目的：
 *   @monaco-editor/react 默认从 cdn.jsdelivr.net 拉 AMD loader.js。
 *   本项目沙箱网络封了 CDN → 编辑器白屏。修复由 src/editor/monacoLoader.ts
 *   把 loader.config 的 paths.vs 改为 '/monaco'，本脚本负责把
 *   node_modules/monaco-editor/min/vs/* 同步到 frontend/public/monaconation/，
  *   vite 与 nginx 都把 public/* 当站点根静态资源送达。
 *
 * 触发：
 *   - package.json: "predev" 与 "prebuild" 钩子（本地与 docker 共用）
 *   - Dockerfile 在 build 阶段跑 npm run build → prebuild → 本脚本
 *
 * 幂等：先清空 public/monaco/ 再复制，避免 monaco 升级后旧版残留导致
 * AMD loader 解析错乱。
 */

import { cpSync, existsSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FE_ROOT = resolve(__dirname, '..');                              // poc-v2/frontend
const MONACO_PKG = resolve(FE_ROOT, 'node_modules/monaco-editor/package.json');
const SRC = resolve(FE_ROOT, 'node_modules/monaco-editor/min/vs');
const DEST = resolve(FE_ROOT, 'public/monaco');

if (!existsSync(SRC)) {
  console.error(`[copy-monaco] source not found: ${SRC}`);
  console.error('  → 先跑 `npm install`');
  process.exit(1);
}

let version = 'unknown';
try {
  version = JSON.parse(readFileSync(MONACO_PKG, 'utf8')).version;
} catch {
  // ignore — keep 'unknown'
}

// 清空旧副本再重建，防止 monaco 升级后旧文件残留
if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true, force: true });
}
cpSync(SRC, DEST, { recursive: true });

const fileCount = readdirSync(DEST, { recursive: true }).length;
console.log(`[copy-monaco] monaco-editor v${version} → public/monaco/ (${fileCount} entries)`);