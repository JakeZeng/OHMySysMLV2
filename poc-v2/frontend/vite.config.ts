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
      '@views': path.resolve(__dirname, '../views'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // ⚠️ 必须是 `'^/api/'` 而不是 `'/api'`。proxy 的 key 是**前缀匹配**，
      // 写成 `'/api'` 会把 SPA 自己的 `/api-keys` 路由也代理到后端 ——
      // 后端没有这条路径，于是 API Keys 页在 dev 下直接 404「page not found」
      // （`/apikeys` 同理）。加 `^…/` 之后只匹配真正的后端路径段。
      //
      // M19：目标地址可用 `VITE_PROXY_TARGET` 覆盖 —— 跑 e2e 时常需要指向
      // 一个**限流关闭**的后端实例（60 req/min/IP 会把连跑多条的 e2e 打成
      // 429），而本机 8080 可能被别的实例占着。
      '^/api/': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
        // M19（第二轮）：把浏览器带来的 `Origin` 头在代理层去掉。
        //
        // 为什么：浏览器对**同源**的 POST/PUT/DELETE 也会带 `Origin`（= 页面源，
        // dev 下是 http://localhost:3002 之类）。Vite 代理默认原样透传这个头，
        // 后端 CORS 中间件（backend/internal/middleware/security.go:256）拿它
        // 跟自己的 Host 比 —— 代理已经把 Host 改成了目标地址（changeOrigin），
        // 于是 Origin ≠ Host，而 dev 端口又不在后端白名单（默认只有 3000/5173）
        // → **所有写操作 403 "origin not allowed"**。
        // 实测现象：e2e 拖一条连线 → 画布上连线出现了、编辑器文本也写进了
        // `transition Off to On;`、PUT 请求体正确，但响应是 403 → 服务端回读没有。
        //
        // 为什么不改后端白名单：白名单是生产安全边界，不能为了 dev 端口无限追加。
        // 为什么可以在这里去掉：浏览器视角下 `/api/...` 与页面**同源**（都由 vite
        // 提供），根本不需要 CORS；代理层抹掉 Origin 后，后端看到的正是它注释里
        // 写的「没有 Origin（如 curl / 服务端调用）：放行」。
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
    },
  },
  // 关键：把 parser.generated.js 当成原生 ESM，不要经过 esbuild 优化
  optimizeDeps: {
    exclude: ['parser.generated.js'],
  },
});
