/**
 * Playwright E2E 配置
 *
 * 覆盖范围（M1）：
 *   1. 注册 → 自动登录
 *   2. 创建项目 → 列表展示
 *   3. 打开编辑器 → 输入 SysML → 看到图
 *   4. 故意写错 → 错误面板
 *   5. 保存 → 刷新后内容仍在
 *
 * 启动方式：
 *   npm run e2e                    # 跑全部
 *   npm run e2e:ui                 # UI 模式
 *   npx playwright test smoke      # 跑 smoke 子集
 *
 * 前提：
 *   1. 后端在 http://localhost:8080 运行（`cd poc-v2/backend && go run cmd/server`）
 *   2. 前端在 http://localhost:3000 运行（`cd poc-v2/frontend && npm run dev`）
 *   3. 已执行 `npx playwright install chromium` 下载浏览器
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,           // M1：测试共享 SQLite，串行更稳
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                      // 单 worker 避免 SQLite 并发写
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // 不自动启 dev server，CI 单独跑前后端（更可控）
});
