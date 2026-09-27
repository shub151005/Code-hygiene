import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

import { parseSourceFile } from '../src/ast/parser.js';
import { scanForDeadCode } from '../src/ast/dead-code-scanner.js';
import { parseProjectManifest } from '../src/dependencies/manifest-parser.js';
import { buildPackageImportMap, checkUnusedDependencies } from '../src/dependencies/unused-checker.js';
import { queryOSV } from '../src/dependencies/osv-auditor.js';
import { generateJsonReport } from '../src/reporter/json-reporter.js';
import { generateHtmlReport } from '../src/reporter/html-reporter.js';
import { runAudit } from '../src/cli.js';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/sample-app');

describe('Code Hygiene & Dead Code Auditor Suite', () => {
  describe('AST Parser', () => {
    it('should successfully parse TypeScript with modern syntax into an AST', () => {
      const authFile = path.join(FIXTURE_DIR, 'src/services/auth.ts');
      const parsed = parseSourceFile(authFile);

      expect(parsed.error).toBeUndefined();
      expect(parsed.ast).not.toBeNull();
      expect(parsed.ast?.type).toBe('File');
    });
  });

  describe('Dead Code & Reachability Analysis', () => {
    it('should identify orphan files, unused exports, and uncalled private functions', () => {
      const files = [
        path.join(FIXTURE_DIR, 'src/index.ts'),
        path.join(FIXTURE_DIR, 'src/services/auth.ts'),
        path.join(FIXTURE_DIR, 'src/services/math.ts'),
        path.join(FIXTURE_DIR, 'src/legacy-utils.ts'),
      ];

      const result = scanForDeadCode(FIXTURE_DIR, files);

      // 1. Orphan file check
      const orphanFile = result.deadCodeFindings.find((f) => f.type === 'orphan-file');
      expect(orphanFile).toBeDefined();
      expect(orphanFile?.filePath).toContain('legacy-utils.ts');

      // 2. Unused export check
      const unusedExport = result.deadCodeFindings.find((f) => f.type === 'unused-export' && f.name === 'unusedCalculator');
      expect(unusedExport).toBeDefined();
      expect(unusedExport?.filePath).toContain('math.ts');

      // 3. Unused private function check
      const unusedFn = result.deadCodeFindings.find((f) => f.type === 'unused-function' && f.name === 'formatSecretToken');
      expect(unusedFn).toBeDefined();
      expect(unusedFn?.filePath).toContain('auth.ts');

      // 4. Active functions should NOT be flagged
      const activeLogin = result.deadCodeFindings.find((f) => f.name === 'loginUser');
      expect(activeLogin).toBeUndefined();

      const activeAdd = result.deadCodeFindings.find((f) => f.name === 'add');
      expect(activeAdd).toBeUndefined();
    });
  });

  describe('Dependency & Reachability Analysis', () => {
    it('should parse manifest and identify unused packages vs reachable packages', () => {
      const manifest = parseProjectManifest(FIXTURE_DIR);
      expect(manifest).not.toBeNull();
      expect(manifest?.name).toBe('sample-vulnerable-app');

      const files = [
        path.join(FIXTURE_DIR, 'src/index.ts'),
        path.join(FIXTURE_DIR, 'src/services/auth.ts'),
        path.join(FIXTURE_DIR, 'src/services/math.ts'),
      ];

      const result = scanForDeadCode(FIXTURE_DIR, files);
      const importMap = buildPackageImportMap(result.fileAnalyses);

      // lodash is imported in auth.ts
      expect(importMap['lodash']).toBeDefined();
      expect(importMap['lodash'].size).toBe(1);

      // left-pad is NOT imported anywhere
      expect(importMap['left-pad']).toBeUndefined();

      const { unusedDependencies, packageUsage } = checkUnusedDependencies(
        manifest!.dependencies,
        importMap
      );

      expect(unusedDependencies.some((d) => d.name === 'left-pad')).toBe(true);
      expect(packageUsage.get('lodash')?.isUsed).toBe(true);
      expect(packageUsage.get('left-pad')?.isUsed).toBe(false);
    });

    it('should query OSV for known vulnerabilities and identify fixed versions', async () => {
      const vulns = await queryOSV('lodash', '4.17.20');
      expect(vulns.length).toBeGreaterThan(0);

      const protoPollution = vulns.find((v) => v.id.includes('GHSA') || v.summary.includes('Prototype'));
      expect(protoPollution).toBeDefined();
    }, 15000);
  });

  describe('Reporters (JSON and HTML)', () => {
    it('should generate valid JSON and interactive HTML reports', async () => {
      const report = await runAudit({
        cwd: FIXTURE_DIR,
        skipVulnerabilityCheck: true, // test offline report generation
      });

      // JSON Reporter
      const jsonOutput = generateJsonReport(report);
      const parsedJson = JSON.parse(jsonOutput);
      expect(parsedJson.metrics).toBeDefined();
      expect(parsedJson.deadCode.length).toBeGreaterThan(0);

      // HTML Reporter
      const htmlOutput = generateHtmlReport(report);
      expect(htmlOutput).toContain('<!DOCTYPE html>');
      expect(htmlOutput).toContain('Code Hygiene & Security Dashboard');
      expect(htmlOutput).toContain('gauge-wrapper');
      expect(htmlOutput).toContain('legacy-utils.ts');
    });
  });

  describe('End-to-End Audit Execution', () => {
    it('should calculate accurate metrics and health score for sample-app', async () => {
      const report = await runAudit({
        cwd: FIXTURE_DIR,
        skipVulnerabilityCheck: false,
      });

      expect(report.metrics.totalFilesScanned).toBe(4);
      expect(report.metrics.deadCodeCount).toBeGreaterThanOrEqual(3);
      expect(report.metrics.unusedDependenciesCount).toBe(1); // left-pad
      expect(report.metrics.vulnerableDependenciesCount).toBe(1); // lodash
      expect(report.metrics.reachableVulnerabilitiesCount).toBe(1); // lodash is reachable!
      expect(report.metrics.healthScore).toBeLessThan(80);
    });
  });
});
