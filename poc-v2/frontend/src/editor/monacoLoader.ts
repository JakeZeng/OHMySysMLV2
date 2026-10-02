/**
 * Monaco Editor loader 配置（M17 修复）。
 *
 * 背景——本项目沙箱网络封了 cdn.jsdelivr.net：
 *   @monaco-editor/react 默认从 `https://cdn.jsdelivr.net/npm/monaco-editor@<v>/min/vs/loader.js`
 *   拉 AMD loader，CDN 不可达 → 浏览器抛 `[object Event]` 的 ensureError，
 *   编辑器整块白屏。修复：把 vs 基础路径指向本地副本 `/monaco/`，由
 *   `scripts/copy-monaco.mjs` 在 predev / prebuild 钩子里把
 *   `node_modules/monaco-editor/min/vs/*` 复制到 `frontend/public/monaco/`，
 *   vite 与 nginx 均会把 `public/*` 原样送达站点根。
 *
 * 模块副作用：首次 import 即写入全局 loader 配置。`SysMLEditor` 与
 * `ModelDiffView` 在顶部都引一次，保证 `<Editor>` 渲染前 loader.config 已生效。
 * loader.config 内部对相同 paths.vs 做 deepMerge（@monaco-editor/loader 1.x），
 * 多次 import 安全。
 */

import { loader } from '@monaco-editor/react';

loader.config({ paths: { vs: '/monaco' } });

export {};