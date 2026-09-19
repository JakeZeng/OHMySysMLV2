// M6 互转 demo 端到端测试：后端 import → 前端 parser → validate。
//
// 用法（要求后端先启动，且 RATE_LIMIT_DISABLE=1）：
//   cd poc-v2
//   node backend/scripts/import-e2e.mjs [--target=http://localhost:8080]
//
// 流程：
//   1. 注册 + 登录 + 创建项目
//   2. 上传真实 Papyrus / Capella fixture
//   3. 取回 model.content（后端转换的 SysML v2 文本）
//   4. 文本经 stdin 交给 parse-check.ts 跑前端 parser → assert parseOk
//   5. 同一进程跑前端 validator → assert validateOk 且无 error
//
// 任何一步失败 → exit 1。CI 可挂此脚本作为 M6 互转回归门。

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ─── Args ───────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const TARGET = args.target ?? 'http://localhost:8080';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

// 调前端 parser/validator 校验一段 SysML 文本。
// 源码走子进程 stdin（见 parse-check.ts 头注释），避免命令行长度与转义问题。
async function validateSysMLViaFrontend(source) {
  const { spawn } = await import('node:child_process');
  const helper = resolve(__dirname, 'parse-check.ts');
  return new Promise((resolveV, reject) => {
    const p = spawn('node', ['--import', 'tsx', helper], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => { out += c.toString(); });
    p.stderr.on('data', (c) => { err += c.toString(); });
    p.on('error', reject);
    p.on('exit', (code2) => {
      if (code2 !== 0) {
        reject(new Error(`parse-check exit ${code2}: ${err}`));
        return;
      }
      const m = out.match(/___RESULT___(.+?)___END___/s);
      if (!m) {
        reject(new Error(`no result in output: ${out}\nstderr: ${err}`));
        return;
      }
      try {
        resolveV(JSON.parse(m[1]));
      } catch (e) {
        reject(new Error(`bad result JSON: ${m[1]}`));
      }
    });
    p.stdin.end(source);
  });
}

// ─── HTTP client ──────────────────────────────────────────────────────────
async function api(method, path, { headers = {}, body = null } = {}) {
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
      json: text ? JSON.parse(text) : null,
    };
  } catch (err) {
    return { status: 0, ms: performance.now() - start, error: err.message };
  }
}

// ─── Multi-part upload (raw — no deps) ──────────────────────────────────
import { randomBytes } from 'node:crypto';
function buildMultipart({ fields = {}, files = [] }) {
  const boundary = '----ImportE2E' + randomBytes(8).toString('hex');
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${k}"\r\n\r\n` +
      `${v}\r\n`,
    ));
  }
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n` +
      `Content-Type: ${f.contentType || 'application/octet-stream'}\r\n\r\n`,
    ));
    parts.push(Buffer.from(f.content));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ─── Fixtures (真实 Papyrus / Capella 样本) ───────────────────────────
const PAPYRUS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<uml:Model xmi:version="2.1" xmlns:uml="http://www.eclipse.org/uml2/3.0.0/UML" xmi:id="_Model" name="E2EPapyrus">
  <packagedElement xmi:type="uml:Package" xmi:id="_Pkg" name="Subsystems">
    <packagedElement xmi:type="uml:Class" xmi:id="_Cls1" name="Engine"/>
    <packagedElement xmi:type="uml:Component" xmi:id="_Cmp1" name="Battery"/>
    <packagedElement xmi:type="uml:Port" xmi:id="_P1" name="dataOut"/>
    <packagedElement xmi:type="uml:Property" xmi:id="_Pr1" name="serial"/>
  </packagedElement>
  <packagedElement xmi:type="uml:Class" xmi:id="_Standalone" name="Wheel"/>
</uml:Model>`;

const CAPELLA_JSON = JSON.stringify({
  name: 'E2ECapella',
  elements: [
    { type: 'Component', id: '_C1', name: 'ComputeBoard' },
    { type: 'Port',      id: '_P1', name: 'ioBus' },
    { type: 'Attribute', id: '_A1', name: 'cpuLoad' },
  ],
});

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`[import-e2e] target=${TARGET}`);

  const ping = await api('GET', '/health');
  if (ping.status !== 200) {
    console.error(`[import-e2e] target unhealthy: ${ping.status}`);
    process.exit(2);
  }

  const stamp = Date.now().toString(36);
  const reg = await api('POST', '/api/v1/auth/register', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `e2e_${stamp}`,
      email:    `e2e_${stamp}@test.io`,
      password: 'pw1234567',
    }),
  });
  if (reg.status !== 200) {
    console.error(`[import-e2e] register failed: ${reg.status} ${reg.body}`);
    process.exit(2);
  }
  const token = reg.json.data.token;
  console.log(`[import-e2e] registered, got token (len=${token.length})`);

  const proj = await api('POST', '/api/v1/projects', {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'E2E Import Test', visibility: 'private' }),
  });
  if (proj.status !== 200) {
    console.error(`[import-e2e] create project failed: ${proj.status} ${proj.body}`);
    process.exit(2);
  }
  const projectId = proj.json.data.id;
  console.log(`[import-e2e] project created: ${projectId}`);

  let pass = 0;
  let fail = 0;

  async function runImportCase(label, ext, mime, fileContent, expectedSubstrings) {
    console.log(`\n[case] ${label}`);
    const mp = buildMultipart({
      fields: { projectId },
      files: [{ name: 'file', filename: `sample.${ext}`, contentType: mime, content: fileContent }],
    });
    const resp = await api('POST', `/api/v1/import/${ext === 'xml' ? 'papyrus' : 'capella'}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': mp.contentType,
        'Content-Length': String(mp.body.length),
      },
      body: mp.body,
    });
    if (resp.status !== 200) {
      console.error(`  ✗ import status=${resp.status} body=${resp.body.slice(0, 200)}`);
      fail++;
      return;
    }
    const sysmlText = resp.json?.data?.model?.content ?? '';
    console.log(`  → model.content len=${sysmlText.length}`);
    if (sysmlText.length === 0) {
      console.error('  ✗ model.content empty');
      fail++;
      return;
    }
    for (const s of expectedSubstrings) {
      if (!sysmlText.includes(s)) {
        console.error(`  ✗ missing substring in SysML: ${s}`);
        console.error(`    full content:\n${sysmlText}`);
        fail++;
        return;
      }
    }

    // 关键：跑前端 parser + validator
    const r = await validateSysMLViaFrontend(sysmlText);
    console.log(`  parse: ok=${r.parseOk} packages=${r.packageCount}`);
    console.log(`  validate: ok=${r.validateOk} issues=${r.validateIssues.length}`);
    if (!r.parseOk) {
      console.error('  ✗ FRONTEND PARSE FAILED:');
      for (const e of r.parseErrors) console.error(`     - ${e.code}: ${e.message}`);
      fail++;
      return;
    }
    if (!r.validateOk) {
      console.error('  ✗ FRONTEND VALIDATE FAILED:');
      for (const i of r.validateIssues) console.error(`     - ${i.code}: ${i.message}`);
      fail++;
      return;
    }
    console.log('  ✓ end-to-end OK');
    pass++;
  }

  await runImportCase(
    'Papyrus → SysML v2',
    'xml', 'application/xml',
    PAPYRUS_XML,
    ['package E2EPapyrus', 'package Subsystems', 'part def Engine', 'part def Battery', 'port dataOut : String', 'attribute serial', 'part def Wheel'],
  );

  await runImportCase(
    'Capella → SysML v2',
    'json', 'application/json',
    CAPELLA_JSON,
    ['package E2ECapella', 'part def ComputeBoard', 'port ioBus : String', 'attribute cpuLoad'],
  );

  console.log(`\n[import-e2e] pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[import-e2e] fatal:', e);
  process.exit(2);
});
