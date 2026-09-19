# 性能压测（M6 W3）

## 快速开始

```bash
# 1. 启动后端（另一个 shell）
go run ./cmd/server

# 2. 跑 smoke 场景（默认 10 VU × 20s）
node scripts/loadtest.mjs

# 3. 跑 full 场景 + 更高负载
node scripts/loadtest.mjs --vus=20 --duration=30 --scenario=full --out=perf-full
```

## 依赖

- Node.js 22+（`http.Agent` keep-alive、`node:perf_hooks`）

无需安装第三方包 —— 脚本只用 Node 内置模块。

> 为什么不用 k6：M6 验收项里写了 "k6 压测报告"，但 k6 二进制在 Windows
> 上需要单独下载且 GitHub release 网络不通。脚本输出 k6 兼容的
> `*-summary.json` 格式（metrics + root_group），可被 k6 解析器或
> Grafana 报告工具直接消费。

## 输出文件

```
perf-baseline-summary.json   k6 兼容 summary（自动化）
perf-baseline-report.md      人读报告（PR review）
```

## M6 目标

- **P95 < 500ms**（公开/鉴权端点）
- **P99 < 1s**（整体）
- **Fail rate < 1%**（稳态）

报告里自动判定每个场景是否达标。

## 场景

### smoke（默认）

| 动作 | 权重 | 鉴权 |
|------|------|------|
| GET /health | 20 | 否 |
| GET /api/v1/templates | 25 | 否 |
| POST /api/v1/auth/register | 5 | 否 |
| GET /api/v1/metamodel/elements | 15 | 是 |
| GET /api/v1/projects | 20 | 是 |
| GET /openapi.yaml | 15 | 否 |

### full

加入 `/openapi.json`、`/metamodel/search`、`POST /projects`、
`/teams`、`/audit-logs` 等鉴权/写路径。
