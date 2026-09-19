/**
 * M3 W2 D8 Prompt Baseline 评分脚本
 *
 * 用法：
 *   npx tsx scripts/m3-prompt-bench.ts \
 *     --prompts prompts/v1.0.yaml \
 *     --samples samples/30-nl-descriptions.jsonl \
 *     --output reports/v1.0-baseline.md
 *
 * 当前 v0.1：mock AI 调用，用 fixtures 测评分逻辑。
 * 真实 AI 接入留 M3 W2 D11 之后（按 ../../../docs/archive/m3-design/m3-prompt-engineering.md §3）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from '../parser/parser.generated.js';
import { validate } from '../validator/validator.js';

// ==================== 类型定义 ====================

interface PromptTemplate {
  version: string;
  system: string;
  schema_summary: string;
  few_shots: FewShot[];
  config: PromptConfig;
}

interface FewShot {
  name: string;
  nl: string;
  code: string;
}

interface PromptConfig {
  provider: string;
  model: string;
  max_tokens: number;
  temperature: number;
  fallback_chain: string[];
}

interface Sample {
  id: string;
  category: string;
  nl: string;
  // 期望输出（用于 diff，非必需）
  expected_code?: string;
}

interface ScoreResult {
  sample_id: string;
  category: string;
  pass_parse: boolean;
  pass_validate: boolean;
  parse_errors: string[];
  validate_errors: string[];
  score: number;  // 0/30/60/100
  generated_code: string;  // mock 或真实
}

interface BaselineReport {
  prompt_version: string;
  total_samples: number;
  parse_pass_count: number;
  validate_pass_count: number;
  pass_rate: number;  // 解析+验证都过 / 总数
  failure_modes: Map<string, number>;
  avg_latency_ms: number;
  total_tokens: number;
  estimated_cost_cny: number;
  samples: ScoreResult[];
  generated_at: string;
}

// ==================== Mock AI Provider ====================

/**
 * 模拟 AI 生成（v0.1）。
 * 真实实现（v1.0）应替换为 ai.ChatWithRetry 调用。
 * 当前用 fixtures 模拟，确保评分逻辑可独立测试。
 */
async function mockAIChat(systemPrompt: string, userNL: string, samples: Sample[]): Promise<{
  content: string;
  tokens: number;
  latency_ms: number;
}> {
  // 找到匹配的 sample，用其 expected_code 模拟 AI 输出
  const sample = samples.find(s => s.nl === userNL);
  if (sample?.expected_code) {
    return {
      content: sample.expected_code,
      tokens: 200,
      latency_ms: 1500 + Math.random() * 1000,
    };
  }
  // 没匹配：返回 mock "bad" 输出（用于测失败模式）
  return {
    content: `package MockExample {
    part def MockClass {  // 错误：用了 class 关键字
    }
}`,
    tokens: 50,
    latency_ms: 800,
  };
}

// ==================== 评分 ====================

function scoreModel(code: string): {
  pass_parse: boolean;
  pass_validate: boolean;
  parse_errors: string[];
  validate_errors: string[];
  score: number;
} {
  let ast = null;
  let parse_errors: string[] = [];

  try {
    ast = parse(code);
    if (ast.errors && ast.errors.length > 0) {
      parse_errors = ast.errors.map((e: any) => e.message);
    }
  } catch (e) {
    parse_errors = [(e as Error).message];
  }

  let validate_errors: string[] = [];
  if (ast) {
    try {
      const validationResult = validate(ast);
      if (validationResult.errors && validationResult.errors.length > 0) {
        validate_errors = validationResult.errors.map((e: any) => e.message);
      }
    } catch (e) {
      validate_errors = [(e as Error).message];
    }
  }

  const pass_parse = parse_errors.length === 0;
  const pass_validate = validate_errors.length === 0;

  let score = 0;
  if (pass_parse && pass_validate) score = 100;
  else if (pass_parse) score = 60;
  else if (parse_errors.length <= 3) score = 30;
  else score = 0;

  return { pass_parse, pass_validate, parse_errors, validate_errors, score };
}

// ==================== 失败模式统计 ====================

function classifyFailure(parseErrors: string[], validateErrors: string[]): string {
  const all = [...parseErrors, ...validateErrors].join(' ').toLowerCase();
  if (all.includes('class') || all.includes('extends')) return 'self_invented_syntax';
  if (all.includes('port')) return 'port_syntax_error';
  if (all.includes('connect')) return 'connect_syntax_error';
  if (all.includes('package')) return 'missing_package';
  if (all.includes('attribute')) return 'attribute_missing_type';
  if (all.includes('multiplicit')) return 'multiplicity_error';
  return 'other';
}

// ==================== 主流程 ====================

async function runBaseline(promptPath: string, samplesPath: string, outputPath: string) {
  console.log(`📋 Loading prompt: ${promptPath}`);
  const promptYAML = fs.readFileSync(promptPath, 'utf-8');
  const prompt = parseYAML(promptYAML) as PromptTemplate;

  console.log(`📋 Loading samples: ${samplesPath}`);
  const samplesContent = fs.readFileSync(samplesPath, 'utf-8');
  const samples: Sample[] = samplesContent
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map((line, idx) => {
      try {
        return { id: `s${idx + 1}`, ...JSON.parse(line) } as Sample;
      } catch (e) {
        console.warn(`⚠️  Failed to parse line ${idx + 1}: ${(e as Error).message}`);
        return null;
      }
    })
    .filter((s): s is Sample => s !== null);

  console.log(`🚀 Running baseline: ${samples.length} samples...`);

  const results: ScoreResult[] = [];
  let totalLatency = 0;
  let totalTokens = 0;

  for (const sample of samples) {
    const start = Date.now();
    const aiResp = await mockAIChat(prompt.system, sample.nl, samples);
    const elapsed = Date.now() - start;
    totalLatency += elapsed;
    totalTokens += aiResp.tokens;

    const score = scoreModel(aiResp.content);
    results.push({
      sample_id: sample.id,
      category: sample.category,
      ...score,
      generated_code: aiResp.content,
    });
  }

  // 聚合
  const parsePassCount = results.filter(r => r.pass_parse).length;
  const validatePassCount = results.filter(r => r.pass_parse && r.pass_validate).length;
  const passRate = results.length > 0 ? validatePassCount / results.length : 0;

  // 失败模式
  const failureModes = new Map<string, number>();
  for (const r of results) {
    if (!r.pass_parse || !r.pass_validate) {
      const mode = classifyFailure(r.parse_errors, r.validate_errors);
      failureModes.set(mode, (failureModes.get(mode) || 0) + 1);
    }
  }

  // 成本估算（DeepSeek 单价）
  const costPerToken = 0.014 / 1_000_000 * 7.2;  // input 单价转人民币
  const estimatedCostCNY = totalTokens * costPerToken;

  const report: BaselineReport = {
    prompt_version: prompt.version,
    total_samples: results.length,
    parse_pass_count: parsePassCount,
    validate_pass_count: validatePassCount,
    pass_rate: passRate,
    failure_modes: failureModes,
    avg_latency_ms: results.length > 0 ? totalLatency / results.length : 0,
    total_tokens: totalTokens,
    estimated_cost_cny: estimatedCostCNY,
    samples: results,
    generated_at: new Date().toISOString(),
  };

  // 写报告
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, formatReport(report), 'utf-8');
  console.log(`✅ Report written to: ${outputPath}`);
  console.log(`📊 Pass rate: ${(passRate * 100).toFixed(1)}% (${validatePassCount}/${results.length})`);
  console.log(`💰 Estimated cost: ¥${estimatedCostCNY.toFixed(2)}`);
  console.log(`⏱️  Avg latency: ${(report.avg_latency_ms).toFixed(0)}ms`);
}

// ==================== 辅助 ====================

/**
 * 极简 YAML 解析器（仅支持 v1.0.yaml 结构）。
 * 真实 M3 W2 D11 实施时用 js-yaml 替换。
 */
function parseYAML(content: string): any {
  // 简化：M3 v0.1 直接读 system 字段（其他字段是 placeholder）
  const lines = content.split('\n');
  const result: any = { few_shots: [] };
  let currentSection = '';
  let currentShot: any = null;

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;

    // 顶层字段
    const topMatch = line.match(/^(\w+):\s*(.*)$/);
    if (topMatch && !line.startsWith(' ') && !line.startsWith('-')) {
      const [, key, value] = topMatch;
      if (value && !value.includes('|')) {
        result[key] = value.trim();
        currentSection = key;
      } else {
        currentSection = key;
      }
      continue;
    }

    // 缩进的 key: value
    const indentMatch = line.match(/^\s+(\w+):\s*(.*)$/);
    if (indentMatch) {
      const [, key, value] = indentMatch;
      if (currentSection === 'few_shots') {
        if (key === 'name' || key === 'nl' || key === 'code') {
          if (key === 'name') {
            if (currentShot) result.few_shots.push(currentShot);
            currentShot = { name: value };
          } else if (currentShot) {
            currentShot[key] = value.replace(/^['|"]|['|"]$/g, '');
          }
        }
      } else if (currentSection === 'config') {
        if (!result.config) result.config = {};
        result.config[key] = value.replace(/^['|"]|['|"]$/g, '');
      }
    }
  }
  if (currentShot) result.few_shots.push(currentShot);

  return result;
}

function formatReport(report: BaselineReport): string {
  const lines: string[] = [];
  lines.push(`# Prompt Baseline Report v${report.prompt_version}`);
  lines.push('');
  lines.push(`**Generated**: ${report.generated_at}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total samples | ${report.total_samples} |`);
  lines.push(`| Parse pass | ${report.parse_pass_count} (${(report.parse_pass_count / report.total_samples * 100).toFixed(1)}%) |`);
  lines.push(`| **Parse + Validate pass** | **${report.validate_pass_count} (${(report.pass_rate * 100).toFixed(1)}%)** |`);
  lines.push(`| Avg latency | ${report.avg_latency_ms.toFixed(0)}ms |`);
  lines.push(`| Total tokens | ${report.total_tokens} |`);
  lines.push(`| **Estimated cost (CNY)** | **¥${report.estimated_cost_cny.toFixed(2)}** |`);
  lines.push('');

  // 失败模式 Top 5
  lines.push('## Failure Modes (Top 5)');
  lines.push('');
  const sortedModes = [...report.failure_modes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (sortedModes.length === 0) {
    lines.push('无失败模式（所有样本通过）');
  } else {
    lines.push('| Mode | Count | % |');
    lines.push('|------|-------|---|');
    for (const [mode, count] of sortedModes) {
      const pct = (count / report.total_samples * 100).toFixed(1);
      lines.push(`| ${mode} | ${count} | ${pct}% |`);
    }
  }
  lines.push('');

  // 样本详情（前 5 个失败 + 前 5 个通过）
  lines.push('## Sample Details');
  lines.push('');
  const failed = report.samples.filter(r => !r.pass_parse || !r.pass_validate);
  const passed = report.samples.filter(r => r.pass_parse && r.pass_validate);

  if (failed.length > 0) {
    lines.push(`### Failed (showing first 5 of ${failed.length})`);
    lines.push('');
    for (const r of failed.slice(0, 5)) {
      lines.push(`- **${r.sample_id}** (${r.category}) score=${r.score}`);
      if (r.parse_errors.length > 0) {
        lines.push(`  - parse: ${r.parse_errors[0]}`);
      }
      if (r.validate_errors.length > 0) {
        lines.push(`  - validate: ${r.validate_errors[0]}`);
      }
      lines.push(`  - code: \`\`\`${r.generated_code.slice(0, 80)}...\`\`\``);
    }
    lines.push('');
  }

  if (passed.length > 0) {
    lines.push(`### Passed (showing first 5 of ${passed.length})`);
    lines.push('');
    for (const r of passed.slice(0, 5)) {
      lines.push(`- **${r.sample_id}** (${r.category}) ✓`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ==================== CLI ====================

async function main() {
  const args = process.argv.slice(2);
  const promptPath = getArg(args, '--prompts') || 'prompts/v1.0.yaml';
  const samplesPath = getArg(args, '--samples') || 'samples/30-nl-descriptions.jsonl';
  const outputPath = getArg(args, '--output') || 'reports/v1.0-baseline.md';

  // 检查文件
  if (!fs.existsSync(promptPath)) {
    console.error(`❌ Prompt file not found: ${promptPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(samplesPath)) {
    console.error(`❌ Samples file not found: ${samplesPath}`);
    process.exit(1);
  }

  await runBaseline(promptPath, samplesPath, outputPath);
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

// 入口
main().catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});
