#!/usr/bin/env node
// Initially authored with IBM Bob Shell; reviewed and hardened locally.
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';

const require = createRequire(import.meta.url);
export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export interface PipelineOptions {
  targetDir: string;
  outDir: string;
  offline: boolean;
  ci: boolean;
  threshold: number;
  failOnDeadCode: boolean;
  failOnVuln: boolean;
}

export function parseOptions(args: string[]): PipelineOptions {
  const program = new Command()
    .configureOutput({ writeErr: (message) => console.error(message.trimEnd()) })
    .name('npm run pipeline --')
    .description('Build, test, and audit a project. Each run preserves its own reports.')
    .argument('[directory]', 'Project to audit', '.')
    .option('--out-dir <directory>', 'Artifact directory', 'artifacts')
    .option('--offline', 'Skip live vulnerability queries', false)
    .option('--skip-vulns', 'Alias for --offline', false)
    .option('--ci', 'Enable quality gates', false)
    .option('--threshold <score>', 'Minimum health score; enables gates', (value) => {
      if (!/^\d+$/.test(value) || Number(value) > 100) {
        throw new InvalidArgumentError('Threshold must be an integer from 0 to 100.');
      }
      return Number(value);
    }, 70)
    .option('--fail-on-dead-code', 'Fail on dead code; enables gates', false)
    .option('--fail-on-vuln', 'Fail on vulnerabilities; enables gates', false)
    .exitOverride();
  program.parse(args, { from: 'user' });
  const opts = program.opts();
  const offline = opts.offline || opts.skipVulns;
  if (offline && opts.failOnVuln) {
    throw new Error('--fail-on-vuln cannot be used with --offline or --skip-vulns.');
  }
  return {
    targetDir: path.resolve(program.args[0] ?? '.'),
    outDir: path.resolve(opts.outDir),
    offline,
    ci: opts.ci || opts.failOnDeadCode || opts.failOnVuln || program.getOptionValueSource('threshold') === 'cli',
    threshold: opts.threshold,
    failOnDeadCode: opts.failOnDeadCode,
    failOnVuln: opts.failOnVuln,
  };
}

type StageName = 'build' | 'pipeline-typecheck' | 'test' | 'audit';
interface StageResult {
  stage: StageName;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  exitCode: number | null;
  durationMs: number;
  error?: string;
}
type Runner = (command: string, args: string[], options: SpawnSyncOptions) => {
  status: number | null;
  error?: Error;
  signal?: string | null;
};

export function runPipeline(options: PipelineOptions, runner: Runner = spawnSync) {
  const started = Date.now();
  fs.mkdirSync(options.outDir, { recursive: true });
  const runDir = fs.mkdtempSync(path.join(options.outDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}-`));
  const stages: StageResult[] = [];
  const reports: { json?: string; html?: string } = {};
  let exitCode = 0;
  let failureStage: StageName | null = null;
  const auditArgs = [path.join(projectRoot, 'dist/cli.js'), options.targetDir, '--out-dir', runDir];
  if (options.offline) auditArgs.push('--skip-vulns');
  if (options.ci) auditArgs.push('--ci', '--threshold', String(options.threshold));
  if (options.failOnDeadCode) auditArgs.push('--fail-on-dead-code');
  if (options.failOnVuln) auditArgs.push('--fail-on-vuln');

  const commands: [StageName, string[]][] = [
    ['build', [require.resolve('typescript/bin/tsc'), '-p', path.join(projectRoot, 'tsconfig.json')]],
    ['pipeline-typecheck', [require.resolve('typescript/bin/tsc'), '-p', path.join(projectRoot, 'tsconfig.pipeline.json')]],
    ['test', [require.resolve('vitest/vitest.mjs'), 'run', '--no-cache']],
    ['audit', auditArgs],
  ];

  console.log(`Artifacts for this run: ${runDir}`);
  if (options.offline) console.log('OFFLINE: live vulnerabilities are NOT checked.');

  for (const [stage, args] of commands) {
    if (exitCode !== 0) {
      stages.push({ stage, status: 'SKIPPED', exitCode: null, durationMs: 0 });
      continue;
    }
    console.log(`\n[${stage}]`);
    const stageStart = Date.now();
    let error: string | undefined;
    let code: number;
    try {
      const result = runner(process.execPath, args, {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: false,
        env: { ...process.env, CI_LIVE_OSV: '0' },
      });
      code = result.status ?? 1;
      error = result.error?.message || (result.signal ? `Terminated by ${result.signal}` : undefined);
    } catch (err) {
      code = 1;
      error = err instanceof Error ? err.message : String(err);
    }
    stages.push({ stage, status: code === 0 ? 'PASSED' : 'FAILED', exitCode: code, durationMs: Date.now() - stageStart, ...(error ? { error } : {}) });
    if (error) console.error(error);
    if (code !== 0) {
      exitCode = code;
      failureStage = stage;
    }
    if (stage === 'audit') {
      for (const format of ['json', 'html'] as const) {
        const reportPath = path.join(runDir, `code-hygiene-report.${format}`);
        if (fs.existsSync(reportPath)) reports[format] = reportPath;
      }
      if (code === 0 && (!reports.json || !reports.html)) {
        exitCode = 1;
        failureStage = stage;
        Object.assign(stages[stages.length - 1], { status: 'FAILED', exitCode: 1, error: 'Audit did not produce both reports.' });
      }
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    targetDirectory: options.targetDir,
    runDirectory: runDir,
    vulnerabilityCheck: options.offline ? 'SKIPPED' : 'REQUESTED',
    overall: exitCode === 0 ? 'PASSED' : 'FAILED',
    exitCode,
    failureStage,
    durationMs: Date.now() - started,
    stages,
    reports,
  };
  const serialized = JSON.stringify(summary, null, 2) + '\n';
  fs.writeFileSync(path.join(runDir, 'pipeline-summary.json'), serialized);
  fs.writeFileSync(path.join(options.outDir, 'pipeline-summary.json'), serialized);
  console.log('\nPipeline summary');
  for (const stage of stages) console.log(`  ${stage.status.padEnd(7)} ${stage.stage}: ${stage.durationMs}ms`);
  for (const [format, location] of Object.entries(reports)) console.log(`  ${format.toUpperCase()}: ${location}`);
  console.log(`  Summary: ${path.join(runDir, 'pipeline-summary.json')}\n  Overall: ${summary.overall}`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (!fs.statSync(options.targetDir).isDirectory()) throw new Error('Target must be a directory.');
    process.exitCode = runPipeline(options).exitCode;
  } catch (err) {
    if ((err as { code?: string }).code === 'commander.helpDisplayed') {
      process.exitCode = 0;
    } else {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  }
}
