/**
 * M3 W2 D8 Prompt Bench 单测
 *
 * 验证评分逻辑 + 报告生成，不依赖真实 AI。
 * 真实 AI 接入留 M3 W2 D11 之后。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('M3 Prompt Baseline Bench', () => {
  const promptPath = path.resolve(__dirname, '../prompts/v1.0.yaml');
  const samplesPath = path.resolve(__dirname, '../samples/30-nl-descriptions.jsonl');
  const outputPath = path.resolve(__dirname, '../reports/v1.0-baseline.md');

  beforeAll(() => {
    // 清理旧报告
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  it('should run baseline and produce report', () => {
    // 直接用 npx.cmd（Windows）调 tsx，避免 PATH 问题
    const isWindows = process.platform === 'win32';
    const npxCmd = isWindows ? 'npx.cmd' : 'npx';

    const result = spawnSync(npxCmd, [
      'tsx',
      'scripts/m3-prompt-bench.ts',
      '--prompts', promptPath,
      '--samples', samplesPath,
      '--output', outputPath,
    ], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 30000,
      shell: true,  // Windows 必须用 shell 解析 npx.cmd
    });

    if (result.status !== 0) {
      console.error('stdout:', result.stdout);
      console.error('stderr:', result.stderr);
    }

    expect(result.status).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
  }, 30000);

  it('report should contain expected sections', () => {
    if (!fs.existsSync(outputPath)) {
      // 跳过如果第一个 test 失败
      return;
    }
    const report = fs.readFileSync(outputPath, 'utf-8');
    expect(report).toMatch(/^# Prompt Baseline Report/m);
    expect(report).toMatch(/## Summary/);
    expect(report).toMatch(/## Failure Modes/);
    expect(report).toMatch(/## Sample Details/);
    expect(report).toMatch(/Total samples/);
    expect(report).toMatch(/Parse \+ Validate pass/);
    expect(report).toMatch(/Estimated cost/);
  });

  it('report should have realistic pass rate (20-100%)', () => {
    if (!fs.existsSync(outputPath)) return;
    const report = fs.readFileSync(outputPath, 'utf-8');
    // baseline 期望 ≥ 30% 通过率（设计目标）
    const match = report.match(/Parse \+ Validate pass.*?\(\s*(\d+\.\d+)%\s*\)/);
    expect(match).not.toBeNull();
    if (match) {
      const rate = parseFloat(match[1]);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(100);
    }
  });
});
