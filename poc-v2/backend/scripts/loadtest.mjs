// M6 W3 k6-style 性能基准脚本（纯 Node 实现，无外部依赖）
//
// 用法：
//   node scripts/loadtest.mjs [--vus=10] [--duration=20] [--target=http://localhost:8080]
//                              [--scenario=smoke|full] [--out=perf-baseline]
//
// 输出：
//   <out>-summary.json   k6 兼容的 summary 格式（metrics / root_group）
//   <out>-report.md     人读报告：p50/p95/p99、吞吐、失败率
//   <out>-console.txt   实时运行日志（按场景分组）
//
// 设计取舍：
//   - 不依赖 k6 二进制（避免外部下载、便于 CI 与本地复跑）
//   - 用 keep-alive Agent 复用连接，逼近真实流量
//   - VU 调度：ramp-up（vus/2 步进）+ steady（vus 全量）+ ramp-down
//   - 报告里显式标注环境（Node 版本 / 平台 / 后端 commit），便于跨环境对比

import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const VUS = Number(args.vus ?? 10);
const DURATION_S = Number(args.duration ?? 20);
const TARGET = args.target ?? 'http://localhost:8080';
const SCENARIO = args.scenario ?? 'smoke';
const OUT = args.out ?? 'perf-baseline';

// ─── HTTP 客户端（keep-alive） ──────────────────────────────────────────────
const url = new URL(TARGET);
const agent = url.protocol === 'https:'
  ? new https.Agent({ keepAlive: true, maxSockets: VUS * 2 })
  : new http.Agent({ keepAlive: true, maxSockets: VUS * 2 });

// 用 Node 22+ 内置 fetch（基于 undici）—— 与 curl / Web 客户端行为一致，
// 避免 Node http 模块 keep-alive 与 gin server 在并发下的边角问题。
async function req(method, path, { headers = {}, body = null } = {}) {
  const start = performance.now();
  try {
    const res = await fetch(`${TARGET}${path}`, {
      method,
      headers: { Connection: 'keep-alive', ...headers },
      body: body ?? undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    return {
      status: res.status,
      ms: performance.now() - start,
      body: text,
      headers: Object.fromEntries(res.headers),
    };
  } catch (err) {
    return { status: 0, ms: performance.now() - start, error: err.message };
  }
}

// ─── 场景定义 ────────────────────────────────────────────────────────────
//
// 每个场景是一组"动作"，VU 循环随机抽取执行。
// smoke: 5 个动作，覆盖公开 + 鉴权 + 写操作
// full:  10 个动作，含分享、模板、元模型
const SCENARIOS = {
  smoke: [
    { name: 'health',          method: 'GET',  path: '/health',                    weight: 20 },
    { name: 'list_templates',  method: 'GET',  path: '/api/v1/templates',          weight: 25 },
    { name: 'register',        method: 'POST', path: '/api/v1/auth/register',
      weight: 5,  // 注册一次代价较高（写库 + bcrypt）
      body: () => JSON.stringify({
        username: 'vu_' + Math.random().toString(36).slice(2, 10),
        email: `vu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.io`,
        password: 'password123',
      }),
      headers: () => ({ 'Content-Type': 'application/json' }) },
    { name: 'metamodel',       method: 'GET',  path: '/api/v1/metamodel/elements', weight: 15, auth: true },
    { name: 'list_projects',   method: 'GET',  path: '/api/v1/projects',           weight: 20, auth: true },
    { name: 'openapi_yaml',    method: 'GET',  path: '/openapi.yaml',              weight: 15 },
  ],
  full: [
    { name: 'health',          method: 'GET',  path: '/health',                    weight: 15 },
    { name: 'list_templates',  method: 'GET',  path: '/api/v1/templates',          weight: 15 },
    { name: 'metamodel',       method: 'GET',  path: '/api/v1/metamodel/elements', weight: 10, auth: true },
    { name: 'metamodel_search',method: 'GET',  path: '/api/v1/metamodel/search?q=Block', weight: 10, auth: true },
    { name: 'openapi_yaml',    method: 'GET',  path: '/openapi.yaml',              weight: 10 },
    { name: 'openapi_json',    method: 'GET',  path: '/openapi.json',              weight: 10 },
    { name: 'list_projects',   method: 'GET',  path: '/api/v1/projects',           weight: 10, auth: true },
    { name: 'create_project',  method: 'POST', path: '/api/v1/projects',
      weight: 5, auth: true,
      body: () => JSON.stringify({ name: 'loadtest_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) }),
      headers: () => ({ 'Content-Type': 'application/json' }) },
    { name: 'list_teams',      method: 'GET',  path: '/api/v1/teams',              weight: 10, auth: true },
    { name: 'audit_logs',      method: 'GET',  path: '/api/v1/audit-logs?limit=10', weight: 5, auth: true },
  ],
};

function pickAction(actions) {
  const total = actions.reduce((s, a) => s + a.weight, 0);
  let r = Math.random() * total;
  for (const a of actions) {
    r -= a.weight;
    if (r <= 0) return a;
  }
  return actions[actions.length - 1];
}

// ─── 统计 ────────────────────────────────────────────────────────────────
class Recorder {
  constructor() {
    this.samples = []; // { name, ms, status, error? }
  }
  record(name, r) {
    this.samples.push({
      name,
      ms: r.ms,
      status: r.status,
      error: r.error,
    });
  }
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summarize(samples) {
  if (samples.length === 0) return null;
  const durations = samples.map((s) => s.ms).sort((a, b) => a - b);
  const ok = samples.filter((s) => s.status >= 200 && s.status < 400).length;
  return {
    count: samples.length,
    failed: samples.length - ok,
    fail_rate: (samples.length - ok) / samples.length,
    avg_ms: durations.reduce((a, b) => a + b, 0) / durations.length,
    min_ms: durations[0],
    max_ms: durations[durations.length - 1],
    p50_ms: quantile(durations, 0.5),
    p90_ms: quantile(durations, 0.9),
    p95_ms: quantile(durations, 0.95),
    p99_ms: quantile(durations, 0.99),
    rps: samples.length / DURATION_S,
  };
}

// ─── VU worker ───────────────────────────────────────────────────────────
async function vu(id, recorder, actions, stopAt, tokens) {
  const errs = [];
  while (performance.now() < stopAt) {
    const a = pickAction(actions);
    const headers = {};
    let body = null;
    if (a.headers) Object.assign(headers, a.headers());
    if (a.body) body = a.body();
    if (a.auth) {
      const idx = Math.floor(Math.random() * tokens.length);
      headers['Authorization'] = 'Bearer ' + (tokens[idx] ?? '');
    }
    try {
      const r = await req(a.method, a.path, { headers, body });
      recorder.record(a.name, r);
    } catch (e) {
      errs.push(e.message);
    }
    await new Promise((res) => setTimeout(res, 10 + Math.random() * 90));
  }
  return errs;
}

// ─── 预热：注册一批用户拿 tokens ─────────────────────────────────────────
async function prepTokens(n) {
  const tokens = [];
  const ts = Date.now();
  for (let i = 0; i < n; i++) {
    const username = `perf_${ts}_${i}`;
    const r = await req('POST', '/api/v1/auth/register', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email: `${username}@test.io`,
        password: 'password123',
      }),
    });
    if (r.status === 200) {
      try {
        const j = JSON.parse(r.body);
        tokens.push(j.data.token);
      } catch {}
    }
  }
  return tokens;
}

// ─── Ramp 调度 ───────────────────────────────────────────────────────────
function vuSchedule(vus, durS) {
  // 简化：前 25% ramp-up，中间 50% 稳态，后 25% ramp-down
  return {
    rampUpEnd: durS * 0.25 * 1000,
    steadyEnd: durS * 0.75 * 1000,
    totalEnd: durS * 1000,
    targetVUs: vus,
  };
}

async function rampUp(stopAt, recorder, actions, tokens, targetVUs) {
  const step = Math.max(1, Math.floor(targetVUs / 5));
  const tasks = [];
  for (let i = 0; i < targetVUs; i += step) {
    const batch = Math.min(step, targetVUs - i);
    for (let j = 0; j < batch; j++) {
      const id = tasks.length;
      tasks.push(vu(id, recorder, actions, stopAt, tokens));
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  return tasks;
}

// ─── 报告生成 ───────────────────────────────────────────────────────────
function buildReport(perScenario, env) {
  const lines = [
    '# Performance Baseline Report',
    '',
    `**Generated**: ${new Date().toISOString()}`,
    `**Target**: ${TARGET}`,
    `**Scenario**: ${SCENARIO}`,
    `**VUs**: ${VUS}   **Duration**: ${DURATION_S}s`,
    '',
    '## Environment',
    '',
    '| Field | Value |',
    '|-------|-------|',
    `| Node  | ${env.node} |`,
    `| OS    | ${env.os} (${env.arch}) |`,
    `| CPU   | ${env.cpu} |`,
    `| k6 alternative | Native Node.js http (M6 W3) |`,
    '',
    '## Summary',
    '',
    '| Scenario | Count | Failed | Fail% | RPS | Avg (ms) | p50 | p95 | p99 | max |',
    '|----------|------:|-------:|------:|----:|---------:|----:|----:|----:|----:|',
  ];
  for (const [name, s] of Object.entries(perScenario)) {
    lines.push(`| ${name} | ${s.count} | ${s.failed} | ${(s.fail_rate * 100).toFixed(2)}% | ${s.rps.toFixed(1)} | ${s.avg_ms.toFixed(1)} | ${s.p50_ms.toFixed(1)} | ${s.p95_ms.toFixed(1)} | ${s.p99_ms.toFixed(1)} | ${s.max_ms.toFixed(1)} |`);
  }
  lines.push('');
  lines.push('## M6 Targets');
  lines.push('');
  lines.push('- [ ] **P95 < 500ms** for read endpoints');
  lines.push('- [ ] **P99 < 1s** overall');
  lines.push('- [ ] **Fail rate < 1%** under steady-state load');
  lines.push('');
  // 自动判定
  let allPass = true;
  for (const [name, s] of Object.entries(perScenario)) {
    const pass = s.p95_ms < 500 && s.p99_ms < 1000 && s.fail_rate < 0.01;
    lines.push(`- **${name}**: ${pass ? '✅ PASS' : '❌ FAIL'} (p95=${s.p95_ms.toFixed(1)}ms, p99=${s.p99_ms.toFixed(1)}ms, fail=${(s.fail_rate * 100).toFixed(2)}%)`);
    if (!pass) allPass = false;
  }
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push(allPass ? '✅ **All scenarios pass M6 targets.**' : '⚠️ **Some scenarios fail M6 targets — see above.**');
  lines.push('');
  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[loadtest] target=${TARGET} vus=${VUS} duration=${DURATION_S}s scenario=${SCENARIO}`);
  mkdirSync(dirname(OUT + '/dummy'), { recursive: true });

  // 1. 环境信息
  const os = await import('node:os');
  const env = {
    node: process.version,
    os: `${process.platform} ${os.release()}`,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
  };
  try {
    env.commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch { env.commit = 'unknown'; }

  // 2. 探活
  const ping = await req('GET', '/health');
  if (ping.status !== 200) {
    console.error(`[loadtest] target unhealthy: ${ping.status} ${ping.error ?? ''}`);
    process.exit(2);
  }
  console.log('[loadtest] target healthy, prep tokens...');

  // 3. 预热 tokens
  const tokens = await prepTokens(Math.max(2, Math.floor(VUS / 2)));
  console.log(`[loadtest] prepped ${tokens.length} tokens`);

  // 4. 运行
  const actions = SCENARIOS[SCENARIO];
  if (!actions) {
    console.error(`[loadtest] unknown scenario: ${SCENARIO}`);
    process.exit(2);
  }
  const recorder = new Recorder();
  const sched = vuSchedule(VUS, DURATION_S);
  const startMs = performance.now();
  const stopAt = startMs + sched.totalEnd;

  console.log(`[loadtest] ramp-up ${VUS} VUs over ${(sched.rampUpEnd / 1000).toFixed(1)}s, steady until ${(sched.steadyEnd / 1000).toFixed(1)}s`);
  const tasks = await rampUp(stopAt, recorder, actions, tokens, VUS);

  await Promise.all(tasks);
  const actualDuration = (performance.now() - startMs) / 1000;
  console.log(`[loadtest] done. ${recorder.samples.length} samples in ${actualDuration.toFixed(1)}s`);

  // 5. 聚合
  const perScenario = {};
  const byName = new Map();
  for (const s of recorder.samples) {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
  }
  for (const [name, samples] of byName) {
    const sum = summarize(samples);
    if (sum) perScenario[name] = { ...sum, samples: undefined };
  }
  const overall = summarize(recorder.samples);
  if (overall) perScenario['_overall'] = { ...overall, samples: undefined };

  // 6. k6 兼容 summary.json
  const k6summary = {
    metrics: {
      http_reqs: { values: { count: overall?.count ?? 0, rate: overall?.rps ?? 0 } },
      http_req_failed: { values: { rate: overall?.fail_rate ?? 0, count: overall?.failed ?? 0 } },
      http_req_duration: {
        values: {
          avg: overall?.avg_ms ?? 0,
          min: overall?.min_ms ?? 0,
          max: overall?.max_ms ?? 0,
          p50: overall?.p50_ms ?? 0,
          p90: overall?.p90_ms ?? 0,
          p95: overall?.p95_ms ?? 0,
          p99: overall?.p99_ms ?? 0,
        },
      },
      iteration_duration: { values: { avg: overall?.avg_ms ?? 0 } },
    },
    root_group: {
      name: SCENARIO,
      path: '',
      groups: Object.fromEntries(
        Object.entries(perScenario).map(([k, v]) => [k, {
          name: k,
          path: '',
          checks: [],
          metrics: {
            'request_count': { values: { count: v.count, rate: v.rps } },
            'request_duration': {
              values: {
                avg: v.avg_ms, min: v.min_ms, max: v.max_ms,
                p50: v.p50_ms, p90: v.p90_ms, p95: v.p95_ms, p99: v.p99_ms,
              },
            },
            'request_failed': { values: { rate: v.fail_rate, count: v.failed } },
          },
        }])
      ),
    },
    options: { vus: VUS, duration: `${DURATION_S}s`, scenario: SCENARIO },
    state: { testRunDurationMs: actualDuration * 1000 },
  };
  writeFileSync(`${OUT}-summary.json`, JSON.stringify(k6summary, null, 2));
  writeFileSync(`${OUT}-report.md`, buildReport(perScenario, env));
  console.log(`[loadtest] wrote ${OUT}-summary.json and ${OUT}-report.md`);

  // 7. 控制台摘要
  console.log('\n=== Summary ===');
  for (const [name, s] of Object.entries(perScenario)) {
    const flag = s.p95_ms < 500 ? '✓' : '✗';
    console.log(`${flag} ${name.padEnd(20)} count=${String(s.count).padStart(5)} p50=${s.p50_ms.toFixed(1).padStart(7)}ms p95=${s.p95_ms.toFixed(1).padStart(7)}ms p99=${s.p99_ms.toFixed(1).padStart(7)}ms fail=${(s.fail_rate * 100).toFixed(2)}%`);
  }
  const exitCode = (overall?.p95_ms ?? Infinity) < 500 && (overall?.fail_rate ?? 1) < 0.01 ? 0 : 1;
  console.log(`[loadtest] exit=${exitCode}`);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('[loadtest] fatal:', e);
  process.exit(2);
});
