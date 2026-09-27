import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseOptions, projectRoot, runPipeline } from '../scripts/pipeline.js';

let tempDir: string;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hygiene-pipeline-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  // tempDir comes directly from mkdtemp, scoped to the OS temporary directory.
  if (!tempDir.startsWith(path.join(os.tmpdir(), 'hygiene-pipeline-'))) throw new Error('Unexpected cleanup path');
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('pipeline options', () => {
  it('accepts options before the directory and enables requested gates', () => {
    const options = parseOptions(['--offline', '--threshold', '90', 'tests/fixtures/sample-app']);
    expect(options.targetDir).toBe(path.join(projectRoot, 'tests/fixtures/sample-app'));
    expect(options.ci).toBe(true);
    expect(options.threshold).toBe(90);
  });
  it.each(['101', '-1', 'oops', '50oops', '1.5'])('rejects invalid threshold %s', (value) => {
    expect(() => parseOptions(['--threshold', value])).toThrow();
  });
  it('rejects incomplete options and an offline vulnerability gate', () => {
    expect(() => parseOptions(['--out-dir'])).toThrow();
    expect(() => parseOptions(['--offline', '--fail-on-vuln'])).toThrow(/cannot be used/);
  });
});

describe('pipeline failures', () => {
  it.each([['build', 0], ['pipeline-typecheck', 1], ['test', 2]] as const)(
    'stops after %s failure, preserves old reports, and writes a fresh summary', (stage, failureIndex) => {
      const oldReport = path.join(tempDir, 'code-hygiene-report.json');
      fs.writeFileSync(oldReport, 'old report');
      const runner = vi.fn((_command, _args, options) => {
        expect(options.shell).toBe(false);
        return { status: runner.mock.calls.length - 1 === failureIndex ? 7 : 0 };
      });
      const summary = runPipeline(parseOptions(['--out-dir', tempDir, '--offline']), runner);
      expect(summary.exitCode).toBe(7);
      expect(summary.failureStage).toBe(stage);
      expect(runner).toHaveBeenCalledTimes(failureIndex + 1);
      expect(summary.stages.at(-1)?.status).toBe('SKIPPED');
      expect(summary.reports).toEqual({});
      expect(fs.readFileSync(oldReport, 'utf8')).toBe('old report');
      expect(JSON.parse(fs.readFileSync(path.join(tempDir, 'pipeline-summary.json'), 'utf8'))).toEqual(summary);
    },
  );
  it('records spawn failure instead of continuing to audit', () => {
    const summary = runPipeline(parseOptions(['--out-dir', tempDir]), () => ({ status: null, error: new Error('spawn failed') }));
    expect(summary.exitCode).toBe(1);
    expect(summary.stages[0].error).toBe('spawn failed');
    expect(summary.stages.at(-1)?.status).toBe('SKIPPED');
  });
  it('fails when a successful audit process produces no reports', () => {
    const summary = runPipeline(parseOptions(['--out-dir', tempDir]), () => ({ status: 0 }));
    expect(summary.exitCode).toBe(1);
    expect(summary.failureStage).toBe('audit');
    expect(summary.reports).toEqual({});
  });
});

describe('actual CLI gate and report retention', () => {
  it('preserves fresh reports on gate failure and passes paths literally', () => {
    const target = path.join(tempDir, 'sample project & data');
    fs.cpSync(path.join(projectRoot, 'tests/fixtures/sample-app'), target, { recursive: true });
    const options = parseOptions([target, '--out-dir', path.join(tempDir, 'audit output & data'), '--offline', '--fail-on-dead-code']);
    // Build/test stage behavior is covered above; run the real source CLI here to
    // exercise the gate without recursively starting Vitest from its own tests.
    const runner = (_command: string, args: string[], spawnOptions: any) => {
      if (!args[0].endsWith('cli.js')) return { status: 0 };
      return spawnSync(process.execPath, ['--import', 'tsx', path.join(projectRoot, 'src/cli.ts'), ...args.slice(1)], {
        ...spawnOptions, stdio: 'pipe', encoding: 'utf8', timeout: 15000,
      });
    };
    const summary = runPipeline(options, runner);
    expect(summary.exitCode).toBe(1);
    expect(summary.failureStage).toBe('audit');
    expect(summary.vulnerabilityCheck).toBe('SKIPPED');
    expect(summary.reports.json).toBeDefined();
    expect(summary.reports.html).toBeDefined();
    const report = JSON.parse(fs.readFileSync(summary.reports.json!, 'utf8'));
    expect(report.targetDirectory).toBe(target);
    expect(report.metrics.deadCodeCount).toBe(5);
    expect(report.metrics.healthScore).toBe(81);
    expect(fs.readFileSync(summary.reports.html!, 'utf8')).toContain('Code Hygiene & Security Dashboard');
    const second = runPipeline({ ...options, ci: false, failOnDeadCode: false }, runner);
    expect(second.exitCode).toBe(0);
    expect(second.runDirectory).not.toBe(summary.runDirectory);
    expect(fs.existsSync(summary.reports.json!)).toBe(true);
  }, 30000);
});
