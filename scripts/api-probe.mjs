// Probe API shape (browser-side, no token leaks to stdout)

import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async () => {
  const out = {};
  const ts = Date.now();

  // Register
  const reg = await fetch('http://localhost:8080/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `probe_${ts}@x.com`,
      username: `probe_${ts}`,
      password: 'Demo123!',
    }),
  });
  const regJson = await reg.json();
  out.register_status = reg.status;
  out.register_keys = Object.keys(regJson);
  if (regJson.data) out.register_data_keys = Object.keys(regJson.data);

  const token = regJson.data?.token;
  const csrf = regJson.data?.csrf_token;

  // Try project create with CSRF
  const proj = await fetch('http://localhost:8080/api/v1/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-CSRF-Token': csrf ?? '',
    },
    body: JSON.stringify({ name: 'ProbeProj' }),
  });
  const projJson = await proj.json();
  out.proj_status = proj.status;
  out.proj_keys = Object.keys(projJson);
  if (projJson.data) {
    out.proj_data_keys = Object.keys(projJson.data);
    if (projJson.data.project) out.proj_project_keys = Object.keys(projJson.data.project);
  }

  // Probe project id extraction
  const projId =
    projJson.data?.project?.id ??
    projJson.data?.id ??
    projJson.project?.id ??
    projJson.id;
  out.extracted_proj_id = projId ?? '(none)';

  if (projId) {
    // Try model create
    const modelRes = await fetch(`http://localhost:8080/api/v1/projects/${projId}/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-CSRF-Token': csrf ?? '',
      },
      body: JSON.stringify({ name: 'ProbeModel', content: 'package X {}\n' }),
    });
    const modelJson = await modelRes.json();
    out.model_status = modelRes.status;
    out.model_keys = Object.keys(modelJson);
    if (modelJson.data) {
      out.model_data_keys = Object.keys(modelJson.data);
      if (modelJson.data.model) out.model_model_keys = Object.keys(modelJson.data.model);
    }
    out.extracted_model_id =
      modelJson.data?.model?.id ?? modelJson.data?.id ?? '(none)';
  }

  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();