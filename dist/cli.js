#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { glob } from 'glob';
import chalk from 'chalk';
import Table from 'cli-table3';
import { scanForDeadCode } from './ast/dead-code-scanner.js';
import { parseProjectManifest } from './dependencies/manifest-parser.js';
import { buildPackageImportMap, checkUnusedDependencies } from './dependencies/unused-checker.js';
import { auditDependencies } from './dependencies/osv-auditor.js';
import { generateJsonReport } from './reporter/json-reporter.js';
import { generateHtmlReport } from './reporter/html-reporter.js';
export async function runAudit(options) {
    const targetDir = path.resolve(options.cwd);
    if (!fs.existsSync(targetDir)) {
        throw new Error(`Target directory does not exist: ${targetDir}`);
    }
    // 1. Discover source files
    const defaultIgnores = [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/coverage/**',
        '**/*.d.ts',
    ];
    const userIgnores = options.ignorePatterns || [];
    const ignore = [...defaultIgnores, ...userIgnores];
    const sourceFiles = await glob('**/*.{js,jsx,ts,tsx,mjs,cjs}', {
        cwd: targetDir,
        absolute: true,
        ignore,
        nodir: true,
    });
    // 2. Dead Code Analysis
    const deadCodeResult = scanForDeadCode(targetDir, sourceFiles);
    // 3. Dependency Analysis
    const manifest = parseProjectManifest(targetDir);
    const packageImportMap = buildPackageImportMap(deadCodeResult.fileAnalyses);
    let dependencyFindings = [];
    let unusedDepsCount = 0;
    let vulnerableDepsCount = 0;
    let reachableVulnsCount = 0;
    if (manifest) {
        const { unusedDependencies } = checkUnusedDependencies(manifest.dependencies, packageImportMap);
        unusedDepsCount = unusedDependencies.length;
        dependencyFindings = await auditDependencies(manifest.dependencies, new Map(manifest.dependencies.map((d) => [
            d.name,
            {
                isUsed: (packageImportMap[d.name]?.size || 0) > 0,
                importedInFiles: Array.from(packageImportMap[d.name] || []),
            },
        ])), options.skipVulnerabilityCheck);
        vulnerableDepsCount = dependencyFindings.filter((d) => d.status === 'vulnerable').length;
        reachableVulnsCount = dependencyFindings.filter((d) => d.status === 'vulnerable' && d.isReachable).length;
    }
    // 4. Compute Health Score (0 - 100)
    let healthScore = 100;
    healthScore -= reachableVulnsCount * 20;
    healthScore -= (vulnerableDepsCount - reachableVulnsCount) * 8;
    healthScore -= unusedDepsCount * 4;
    healthScore -= deadCodeResult.deadCodeFindings.length * 3;
    healthScore = Math.max(0, Math.min(100, healthScore));
    const metrics = {
        totalFilesScanned: sourceFiles.length,
        totalFunctionsAnalyzed: deadCodeResult.totalFunctionsCount,
        totalDependencies: manifest ? manifest.dependencies.length : 0,
        deadCodeCount: deadCodeResult.deadCodeFindings.length,
        unusedDependenciesCount: unusedDepsCount,
        vulnerableDependenciesCount: vulnerableDepsCount,
        reachableVulnerabilitiesCount: reachableVulnsCount,
        healthScore,
    };
    return {
        timestamp: new Date().toISOString(),
        targetDirectory: targetDir,
        metrics,
        deadCode: deadCodeResult.deadCodeFindings,
        dependencies: dependencyFindings,
    };
}
// Summary printer for CLI feedback
function printSummary(report, jsonPath, htmlPath) {
    const { metrics, targetDirectory } = report;
    console.log('\n' + chalk.bold.cyan('╔══════════════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║                      CODE HYGIENE & DEPENDENCY AUDIT                         ║'));
    console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════════════════════════╝\n'));
    console.log(chalk.gray(`Target:    ${path.resolve(targetDirectory)}`));
    console.log(chalk.gray(`Timestamp: ${new Date(report.timestamp).toLocaleString()}`));
    let scoreColor = chalk.bold.green;
    let statusBadge = chalk.bgGreen.black(' HEALTHY ');
    if (metrics.healthScore < 50) {
        scoreColor = chalk.bold.red;
        statusBadge = chalk.bgRed.white(' CRITICAL ATTENTION REQUIRED ');
    }
    else if (metrics.healthScore < 80) {
        scoreColor = chalk.bold.yellow;
        statusBadge = chalk.bgYellow.black(' WARNING: TECHNICAL DEBT ACCUMULATING ');
    }
    console.log('\n' + chalk.bold('Codebase Health Score: ') + scoreColor(`${metrics.healthScore}/100`) + '  ' + statusBadge);
    console.log(chalk.gray('─────────────────────────────────────────────────────────────────────────────'));
    console.log(chalk.bold('Files Scanned: ') + chalk.cyan(metrics.totalFilesScanned) + ' | ' +
        chalk.bold('Functions Analyzed: ') + chalk.cyan(metrics.totalFunctionsAnalyzed) + ' | ' +
        chalk.bold('Dependencies: ') + chalk.cyan(metrics.totalDependencies));
    console.log(chalk.bold('Dead Code Items: ') + (metrics.deadCodeCount > 0 ? chalk.red(metrics.deadCodeCount) : chalk.green('0')) + ' | ' +
        chalk.bold('Unused Packages: ') + (metrics.unusedDependenciesCount > 0 ? chalk.yellow(metrics.unusedDependenciesCount) : chalk.green('0')) + ' | ' +
        chalk.bold('Vulnerable Packages: ') + (metrics.vulnerableDependenciesCount > 0 ? chalk.red(metrics.vulnerableDependenciesCount) : chalk.green('0')) +
        (metrics.reachableVulnerabilitiesCount > 0 ? chalk.bold.red(` (${metrics.reachableVulnerabilitiesCount} Reachable!)`) : ''));
    // Quick Table for Dead Code
    if (report.deadCode.length > 0) {
        console.log('\n' + chalk.bold.underline('Dead Code Findings:'));
        const deadTable = new Table({
            head: [chalk.cyan('Type'), chalk.cyan('Symbol / File'), chalk.cyan('Location'), chalk.cyan('Action')],
            colWidths: [18, 25, 20, 35],
            wordWrap: true,
        });
        for (const item of report.deadCode.slice(0, 10)) {
            const relPath = path.relative(targetDirectory, item.filePath);
            deadTable.push([chalk.yellow(item.type), chalk.bold(item.name), `${relPath}:${item.line}`, item.suggestion]);
        }
        console.log(deadTable.toString());
    }
    // Quick Table for Dependencies
    const depIssues = report.dependencies.filter((d) => d.status !== 'clean');
    if (depIssues.length > 0) {
        console.log('\n' + chalk.bold.underline('Dependency Issues:'));
        const depTable = new Table({
            head: [chalk.cyan('Package'), chalk.cyan('Version'), chalk.cyan('Status'), chalk.cyan('Reachable?'), chalk.cyan('Recommendation')],
            colWidths: [20, 12, 14, 14, 38],
            wordWrap: true,
        });
        for (const d of depIssues) {
            depTable.push([
                chalk.bold(d.packageName),
                d.declaredVersion,
                d.status === 'vulnerable' ? chalk.bold.red('VULNERABLE') : chalk.yellow('UNUSED'),
                d.isReachable ? chalk.bold.red('YES') : chalk.gray('NO'),
                d.upgradeSuggestion || 'Review',
            ]);
        }
        console.log(depTable.toString());
    }
    console.log('\n' + chalk.gray('─────────────────────────────────────────────────────────────────────────────'));
    console.log(chalk.green(`✔ JSON Report: `) + chalk.cyan(path.resolve(jsonPath)));
    console.log(chalk.green(`✔ HTML Report: `) + chalk.cyan(path.resolve(htmlPath)));
    console.log(chalk.gray('─────────────────────────────────────────────────────────────────────────────\n'));
}
// CLI Commander setup
const program = new Command();
program
    .name('code-hygiene')
    .description('Audit codebases for dead code, unused functions, and vulnerable dependencies with reachability analysis.')
    .version('1.0.0')
    .argument('[directory]', 'Target directory to scan', '.')
    .option('-o, --out-dir <dir>', 'Directory to save generated JSON and HTML reports', '.')
    .option('--json-file <filename>', 'Custom filename for JSON report', 'code-hygiene-report.json')
    .option('--html-file <filename>', 'Custom filename for HTML report', 'code-hygiene-report.html')
    .option('--ci', 'CI mode: exits with code 1 if health score or safety gates fail', false)
    .option('--threshold <score>', 'Minimum acceptable health score in CI mode', '70')
    .option('--fail-on-dead-code', 'Fail CI mode if any dead code is found', false)
    .option('--fail-on-vuln', 'Fail CI mode if any vulnerable dependency is found', false)
    .option('--skip-vulns', 'Skip network CVE checks for fast offline auditing', false)
    .action(async (dir, opts) => {
    try {
        const options = {
            cwd: dir,
            ci: opts.ci,
            minHealthScore: parseInt(opts.threshold, 10),
            failOnDeadCode: opts.failOnDeadCode,
            failOnVuln: opts.failOnVuln,
            skipVulnerabilityCheck: opts.skipVulns,
        };
        // 1. Run the Scan
        const report = await runAudit(options);
        // 2. Call BOTH reporters
        const outDir = path.resolve(opts.outDir);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const jsonPath = path.join(outDir, opts.jsonFile);
        const htmlPath = path.join(outDir, opts.htmlFile);
        generateJsonReport(report, jsonPath);
        generateHtmlReport(report, htmlPath);
        // 3. Print terminal summary
        printSummary(report, jsonPath, htmlPath);
        // 4. CI Gates
        if (opts.ci) {
            const minScore = parseInt(opts.threshold, 10);
            let failed = false;
            if (report.metrics.healthScore < minScore) {
                console.error(chalk.red(`✖ CI FAILED: Health Score (${report.metrics.healthScore}) is below threshold (${minScore})`));
                failed = true;
            }
            if (opts.failOnDeadCode && report.metrics.deadCodeCount > 0) {
                console.error(chalk.red(`✖ CI FAILED: Dead code detected (${report.metrics.deadCodeCount} items)`));
                failed = true;
            }
            if (opts.failOnVuln && report.metrics.vulnerableDependenciesCount > 0) {
                console.error(chalk.red(`✖ CI FAILED: Vulnerabilities detected (${report.metrics.vulnerableDependenciesCount} packages)`));
                failed = true;
            }
            if (failed) {
                process.exit(1);
            }
            else {
                console.log(chalk.green('✔ CI PASSED: All hygiene and security gates satisfied.\n'));
            }
        }
    }
    catch (err) {
        console.error(chalk.red(`\nError: ${err.message}`));
        process.exit(1);
    }
});
// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')) {
    program.parse();
}
