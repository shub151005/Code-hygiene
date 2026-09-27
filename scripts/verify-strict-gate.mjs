import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const output = fs.mkdtempSync(path.join(root, 'artifacts', 'gate-check-'));
const result = spawnSync(process.execPath, [
  '--import', 'tsx', 'scripts/pipeline.ts', 'tests/fixtures/sample-app',
  '--offline', '--ci', '--fail-on-dead-code', '--out-dir', output,
], { cwd: root, shell: false, stdio: 'inherit' });
assert.ifError(result.error);
assert.equal(result.status, 1, 'The strict sample must exit 1');
const summary = JSON.parse(fs.readFileSync(path.join(output, 'pipeline-summary.json'), 'utf8'));
assert.equal(summary.exitCode, 1);
assert.equal(summary.failureStage, 'audit', 'A build/test failure is not a successful gate verification');
assert.ok(summary.stages.filter(stage => stage.stage !== 'audit').every(stage => stage.status === 'PASSED'));
assert.ok(fs.existsSync(summary.reports.json));
assert.ok(fs.existsSync(summary.reports.html));
const report = JSON.parse(fs.readFileSync(summary.reports.json, 'utf8'));
assert.ok(report.metrics.deadCodeCount > 0);
console.log('Verified: the dead-code gate failed, with both reports retained.');
