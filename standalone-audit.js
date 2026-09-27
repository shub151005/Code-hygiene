#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { glob } from 'glob';
import chalk from 'chalk';
import Table from 'cli-table3';
import { Command } from 'commander';

const traverse = (typeof _traverse.default === 'function' ? _traverse.default : _traverse);
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const OSV_API_URL = 'https://api.osv.dev/v1/query';

// --- 1. AST Parser ---
function parseSourceFile(filePath) {
  try {
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    const ast = parse(sourceCode, {
      sourceType: 'module',
      plugins: [
        'typescript',
        'jsx',
        'decorators-legacy',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'exportDefaultFrom',
        'topLevelAwait',
      ],
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      errorRecovery: true,
    });
    return { filePath, sourceCode, ast };
  } catch (err) {
    return { filePath, sourceCode: '', ast: null, error: err.message };
  }
}

// --- 2. Call Graph & AST Analysis ---
function analyzeFileAST(filePath, ast) {
  const imports = [];
  const declarations = new Map();
  const internalReferences = new Map();
  const exportedSymbols = new Set();

  const recordRef = (name) => {
    internalReferences.set(name, (internalReferences.get(name) || 0) + 1);
  };

  traverse(ast, {
    ImportDeclaration(nodePath) {
      const source = nodePath.node.source.value;
      const importedSymbols = [];
      for (const specifier of nodePath.node.specifiers) {
        if (t.isImportDefaultSpecifier(specifier)) importedSymbols.push('default');
        else if (t.isImportSpecifier(specifier)) {
          const importedName = t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
          importedSymbols.push(importedName);
        } else if (t.isImportNamespaceSpecifier(specifier)) importedSymbols.push('*');
      }

      const isPackage = !source.startsWith('.') && !source.startsWith('/') && !path.isAbsolute(source);
      let packageName;
      if (isPackage) {
        packageName = source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0];
      }
      imports.push({ rawSource: source, isPackage, packageName, importedSymbols });
    },
    CallExpression(nodePath) {
      const callee = nodePath.node.callee;
      if (t.isIdentifier(callee, { name: 'require' }) && nodePath.node.arguments.length > 0) {
        const arg = nodePath.node.arguments[0];
        if (t.isStringLiteral(arg)) {
          const source = arg.value;
          const isPackage = !source.startsWith('.') && !source.startsWith('/') && !path.isAbsolute(source);
          const packageName = isPackage ? (source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0]) : undefined;
          imports.push({ rawSource: source, isPackage, packageName, importedSymbols: ['*'] });
        }
      }
    },
    FunctionDeclaration(nodePath) {
      if (nodePath.node.id) {
        const name = nodePath.node.id.name;
        const line = nodePath.node.loc?.start.line || 1;
        const isExported = t.isExportNamedDeclaration(nodePath.parent) || t.isExportDefaultDeclaration(nodePath.parent);
        declarations.set(name, { name, kind: 'function', isExported, line });
        if (isExported) exportedSymbols.add(t.isExportDefaultDeclaration(nodePath.parent) ? 'default' : name);
      }
    },
    VariableDeclarator(nodePath) {
      if (t.isIdentifier(nodePath.node.id)) {
        const name = nodePath.node.id.name;
        const line = nodePath.node.loc?.start.line || 1;
        const isExported = !!nodePath.findParent((p) => p.isExportNamedDeclaration());
        const isFunc = t.isArrowFunctionExpression(nodePath.node.init) || t.isFunctionExpression(nodePath.node.init);
        declarations.set(name, { name, kind: isFunc ? 'function' : 'variable', isExported, line });
        if (isExported) exportedSymbols.add(name);
      }
    },
    ExportNamedDeclaration(nodePath) {
      if (nodePath.node.specifiers) {
        for (const specifier of nodePath.node.specifiers) {
          if (t.isExportSpecifier(specifier)) {
            const exportedName = t.isIdentifier(specifier.exported) ? specifier.exported.name : specifier.exported.value;
            exportedSymbols.add(exportedName);
          }
        }
      }
    },
    Identifier(nodePath) {
      const name = nodePath.node.name;
      if (
        (t.isFunctionDeclaration(nodePath.parent) && nodePath.parent.id === nodePath.node) ||
        (t.isVariableDeclarator(nodePath.parent) && nodePath.parent.id === nodePath.node) ||
        (t.isImportSpecifier(nodePath.parent) && nodePath.parent.local === nodePath.node) ||
        (t.isImportDefaultSpecifier(nodePath.parent) && nodePath.parent.local === nodePath.node) ||
        (t.isObjectProperty(nodePath.parent) && nodePath.parent.key === nodePath.node && !nodePath.parent.computed) ||
        (t.isMemberExpression(nodePath.parent) && nodePath.parent.property === nodePath.node && !nodePath.parent.computed)
      ) return;
      recordRef(name);
    }
  });

  return { filePath, imports, declarations, internalReferences, exportedSymbols };
}

// --- 3. Dead Code Detection ---
function resolveImportPath(importingFilePath, rawSource) {
  if (!rawSource.startsWith('.') && !rawSource.startsWith('/')) return null;
  const dir = path.dirname(importingFilePath);
  let targetBasePath = path.resolve(dir, rawSource);

  if (fs.existsSync(targetBasePath) && fs.statSync(targetBasePath).isFile()) {
    return path.normalize(targetBasePath);
  }

  const ext = path.extname(targetBasePath);
  if (ext) {
    const withoutExt = targetBasePath.slice(0, -ext.length);
    for (const testExt of ['.ts', '.tsx', '.js', '.jsx']) {
      const candidate = withoutExt + testExt;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.normalize(candidate);
    }
  }

  for (const e of EXTENSIONS) {
    const c1 = targetBasePath + e;
    if (fs.existsSync(c1) && fs.statSync(c1).isFile()) return path.normalize(c1);
    const c2 = path.join(targetBasePath, `index${e}`);
    if (fs.existsSync(c2) && fs.statSync(c2).isFile()) return path.normalize(c2);
  }
  return null;
}

function detectEntryPoints(projectRoot, filePaths) {
  const entryPoints = new Set();
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const candidates = [pkg.main, pkg.module, typeof pkg.bin === 'string' ? pkg.bin : null, ...(pkg.bin && typeof pkg.bin === 'object' ? Object.values(pkg.bin) : [])].filter(Boolean);
      for (const c of candidates) {
        const full = path.resolve(projectRoot, c);
        if (fs.existsSync(full)) entryPoints.add(path.normalize(full));
        else {
          for (const ext of EXTENSIONS) {
            if (fs.existsSync(full + ext)) entryPoints.add(path.normalize(full + ext));
          }
        }
      }
    } catch {}
  }
  for (const fp of filePaths) {
    const base = path.basename(fp).toLowerCase();
    if (base.startsWith('index.') || base.startsWith('main.') || base.startsWith('app.') || base.startsWith('server.') || base.startsWith('cli.')) {
      entryPoints.add(path.normalize(fp));
    }
  }
  return entryPoints;
}

function scanForDeadCode(projectRoot, filePaths) {
  const fileAnalyses = new Map();
  const normalizedFiles = filePaths.map((f) => path.normalize(f));
  const entryPoints = detectEntryPoints(projectRoot, normalizedFiles);

  let totalFunctionsCount = 0;
  for (const fp of normalizedFiles) {
    const parsed = parseSourceFile(fp);
    if (!parsed.ast) continue;
    const analysis = analyzeFileAST(fp, parsed.ast);
    fileAnalyses.set(fp, analysis);
    for (const decl of analysis.declarations.values()) {
      if (decl.kind === 'function') totalFunctionsCount++;
    }
  }

  const fileInboundImports = new Map();
  const fileInboundSymbols = new Map();

  for (const [callerFile, analysis] of fileAnalyses.entries()) {
    for (const imp of analysis.imports) {
      if (!imp.isPackage) {
        const resolved = resolveImportPath(callerFile, imp.rawSource);
        if (resolved && fileAnalyses.has(resolved)) {
          if (!fileInboundImports.has(resolved)) fileInboundImports.set(resolved, new Set());
          fileInboundImports.get(resolved).add(callerFile);

          if (!fileInboundSymbols.has(resolved)) fileInboundSymbols.set(resolved, new Set());
          for (const s of imp.importedSymbols) fileInboundSymbols.get(resolved).add(s);
        }
      }
    }
  }

  const findings = [];
  for (const filePath of normalizedFiles) {
    const isEntry = entryPoints.has(filePath);
    const inbound = fileInboundImports.get(filePath);

    if (!isEntry && (!inbound || inbound.size === 0)) {
      const base = path.basename(filePath);
      if (base.includes('.test.') || base.includes('.spec.')) continue;
      findings.push({
        type: 'orphan-file',
        name: path.relative(projectRoot, filePath),
        filePath,
        line: 1,
        suggestion: 'File is never imported anywhere in the project tree. Safe to remove or archive.',
      });
    }
  }

  for (const [filePath, analysis] of fileAnalyses.entries()) {
    const isEntry = entryPoints.has(filePath);
    const inboundSymbols = fileInboundSymbols.get(filePath) || new Set();

    for (const [name, decl] of analysis.declarations.entries()) {
      if (decl.isExported) {
        if (!isEntry) {
          const isImportedElsewhere = inboundSymbols.has(name) || inboundSymbols.has('*');
          const isReferencedLocally = (analysis.internalReferences.get(name) || 0) > 0;
          if (!isImportedElsewhere && !isReferencedLocally) {
            findings.push({
              type: 'unused-export',
              name,
              filePath,
              line: decl.line,
              suggestion: `Exported ${decl.kind} '${name}' is never imported by any file or used internally.`,
            });
          }
        }
      } else {
        const refCount = analysis.internalReferences.get(name) || 0;
        if (refCount === 0) {
          findings.push({
            type: decl.kind === 'function' ? 'unused-function' : 'unused-variable',
            name,
            filePath,
            line: decl.line,
            suggestion: `Unexported ${decl.kind} '${name}' is declared but never referenced or invoked.`,
          });
        }
      }
    }
  }

  return { fileAnalyses, deadCodeFindings: findings, totalFunctionsCount };
}

// --- 4. Dependencies & OSV Vulnerabilities ---
function parseProjectManifest(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const dependencies = [];
    if (pkg.dependencies) {
      for (const [name, ver] of Object.entries(pkg.dependencies)) {
        dependencies.push({ name, declaredVersion: ver, isDev: false });
      }
    }
    if (pkg.devDependencies) {
      for (const [name, ver] of Object.entries(pkg.devDependencies)) {
        dependencies.push({ name, declaredVersion: ver, isDev: true });
      }
    }
    return { name: pkg.name || 'app', dependencies };
  } catch {
    return null;
  }
}

async function queryOSV(packageName, version) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const cleanVer = version.replace(/^[\^~>=<v]+/, '').trim();

    const response = await fetch(OSV_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: cleanVer, package: { name: packageName, ecosystem: 'npm' } }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return [];

    const data = await response.json();
    if (!data || !Array.isArray(data.vulns)) return [];

    return data.vulns.map((v) => {
      let fixedVersion;
      if (Array.isArray(v.affected)) {
        for (const aff of v.affected) {
          if (Array.isArray(aff.ranges)) {
            for (const r of aff.ranges) {
              if (Array.isArray(r.events)) {
                for (const ev of r.events) {
                  if (ev.fixed) { fixedVersion = ev.fixed; break; }
                }
              }
              if (fixedVersion) break;
            }
          }
          if (fixedVersion) break;
        }
      }
      return {
        id: v.id,
        summary: v.summary || (v.details ? v.details.slice(0, 90) + '...' : 'Vulnerability'),
        severity: (v.database_specific?.severity || 'HIGH').toUpperCase(),
        fixedVersion,
      };
    });
  } catch {
    return [];
  }
}

// --- 5. Report Generators ---
function generateJsonReport(report, outputPath) {
  const json = JSON.stringify(report, null, 2);
  if (outputPath) fs.writeFileSync(outputPath, json, 'utf-8');
  return json;
}

function generateHtmlReport(report, outputPath) {
  const { metrics, deadCode, dependencies, targetDirectory, timestamp } = report;
  const scoreColor = metrics.healthScore >= 80 ? '#10b981' : metrics.healthScore >= 50 ? '#f59e0b' : '#ef4444';
  const circ = 2 * Math.PI * 45;
  const offset = circ - (metrics.healthScore / 100) * circ;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Code Hygiene Dashboard</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; padding: 2rem; margin: 0; }
    .wrap { max-width: 1100px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    .gauge { position: relative; width: 90px; height: 90px; }
    .gauge svg { transform: rotate(-90deg); width: 100%; height: 100%; }
    .circle-bg { stroke: #334155; fill: none; stroke-width: 10; }
    .circle-val { stroke: ${scoreColor}; fill: none; stroke-width: 10; stroke-dasharray: ${circ}; stroke-dashoffset: ${offset}; }
    .score-txt { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; font-weight: 700; color: ${scoreColor}; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border: 1px solid #334155; padding: 1.2rem; border-radius: 0.75rem; }
    .num { font-size: 1.75rem; font-weight: 700; }
    .label { font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; }
    .table-card { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1.2rem; margin-bottom: 1.5rem; }
    .item { padding: 0.75rem; border-bottom: 1px solid #334155; }
    .badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .badge-red { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .badge-yellow { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div>
        <h1>Code Hygiene & Security Dashboard</h1>
        <div style="color: #94a3b8; font-size: 0.85rem">Target: ${targetDirectory} • Date: ${new Date(timestamp).toLocaleString()}</div>
      </div>
      <div class="gauge">
        <svg viewBox="0 0 100 100">
          <circle class="circle-bg" cx="50" cy="50" r="45"></circle>
          <circle class="circle-val" cx="50" cy="50" r="45"></circle>
        </svg>
        <div class="score-txt">${metrics.healthScore}</div>
      </div>
    </div>
    <div class="grid">
      <div class="card"><div class="num" style="color: #38bdf8">${metrics.totalFilesScanned}</div><div class="label">Files Scanned</div></div>
      <div class="card"><div class="num" style="color: ${metrics.deadCodeCount > 0 ? '#ef4444' : '#10b981'}">${metrics.deadCodeCount}</div><div class="label">Dead Code Items</div></div>
      <div class="card"><div class="num" style="color: ${metrics.unusedDependenciesCount > 0 ? '#f59e0b' : '#10b981'}">${metrics.unusedDependenciesCount}</div><div class="label">Unused Packages</div></div>
      <div class="card"><div class="num" style="color: ${metrics.vulnerableDependenciesCount > 0 ? '#ef4444' : '#10b981'}">${metrics.vulnerableDependenciesCount}</div><div class="label">Vulnerabilities (${metrics.reachableVulnerabilitiesCount} Reachable)</div></div>
    </div>
    <div class="table-card">
      <h3 style="margin-bottom: 1rem">Dead Code & Orphan Findings</h3>
      ${deadCode.map(d => `
        <div class="item">
          <span class="badge ${d.type === 'orphan-file' ? 'badge-red' : 'badge-yellow'}">${d.type}</span>
          <strong style="margin-left: 0.5rem">${d.name}</strong> <span style="color: #94a3b8">(${d.filePath}:${d.line})</span>
          <div style="font-size: 0.85rem; color: #cbd5e1; margin-top: 0.25rem">${d.suggestion}</div>
        </div>
      `).join('')}
    </div>
    <div class="table-card">
      <h3 style="margin-bottom: 1rem">Dependency Issues & CVEs</h3>
      ${dependencies.filter(d => d.status !== 'clean').map(d => `
        <div class="item">
          <span class="badge ${d.status === 'vulnerable' ? 'badge-red' : 'badge-yellow'}">${d.status}</span>
          <strong style="margin-left: 0.5rem">${d.packageName}</strong> (v${d.declaredVersion})
          <span style="color: ${d.isReachable ? '#f87171' : '#94a3b8'}">• ${d.isReachable ? 'REACHABLE IN CODE' : 'NOT IMPORTED'}</span>
          <div style="font-size: 0.85rem; color: #34d399; margin-top: 0.25rem">💡 ${d.upgradeSuggestion}</div>
        </div>
      `).join('')}
    </div>
  </div>
</body>
</html>`;
  if (outputPath) fs.writeFileSync(outputPath, html, 'utf-8');
  return html;
}

// --- 6. Main Orchestrator ---
async function main() {
  const program = new Command();
  program
    .argument('[dir]', 'Directory to scan', '.')
    .option('-o, --out-dir <dir>', 'Output directory for reports', '.')
    .option('--ci', 'CI mode (exit code 1 if failed)', false)
    .option('--threshold <num>', 'Minimum score for CI', '70')
    .action(async (target, opts) => {
      const targetDir = path.resolve(target);
      console.log(chalk.cyan(`\n🔍 Scanning codebase: ${targetDir}`));

      const files = await glob('**/*.{js,jsx,ts,tsx,mjs,cjs}', {
        cwd: targetDir,
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**'],
        nodir: true,
      });

      const deadResult = scanForDeadCode(targetDir, files);
      const manifest = parseProjectManifest(targetDir);

      const importMap = {};
      for (const [fp, analysis] of deadResult.fileAnalyses.entries()) {
        for (const imp of analysis.imports) {
          if (imp.isPackage && imp.packageName) {
            if (!importMap[imp.packageName]) importMap[imp.packageName] = new Set();
            importMap[imp.packageName].add(fp);
          }
        }
      }

      let depsFindings = [];
      let unusedCount = 0;
      let vulnCount = 0;
      let reachableVulnCount = 0;

      if (manifest) {
        depsFindings = await Promise.all(
          manifest.dependencies.map(async (dep) => {
            const isUsed = (importMap[dep.name]?.size || 0) > 0;
            const vulns = await queryOSV(dep.name, dep.declaredVersion);
            let status = 'clean';
            let suggestion = 'No action';

            if (vulns.length > 0) {
              status = 'vulnerable';
              const fix = vulns.find((v) => v.fixedVersion)?.fixedVersion;
              suggestion = fix ? `Upgrade to >= ${fix}` : 'Review advisories';
            } else if (!dep.isDev && !isUsed) {
              status = 'unused';
              suggestion = 'Remove package (never imported)';
            }

            return { packageName: dep.name, declaredVersion: dep.declaredVersion, status, isReachable: isUsed, vulnerabilities: vulns, upgradeSuggestion: suggestion };
          })
        );

        unusedCount = depsFindings.filter((d) => d.status === 'unused').length;
        vulnCount = depsFindings.filter((d) => d.status === 'vulnerable').length;
        reachableVulnCount = depsFindings.filter((d) => d.status === 'vulnerable' && d.isReachable).length;
      }

      let healthScore = 100 - (reachableVulnCount * 20) - ((vulnCount - reachableVulnCount) * 8) - (unusedCount * 4) - (deadResult.deadCodeFindings.length * 3);
      healthScore = Math.max(0, Math.min(100, healthScore));

      const report = {
        timestamp: new Date().toISOString(),
        targetDirectory: targetDir,
        metrics: {
          totalFilesScanned: files.length,
          totalFunctionsAnalyzed: deadResult.totalFunctionsCount,
          totalDependencies: manifest ? manifest.dependencies.length : 0,
          deadCodeCount: deadResult.deadCodeFindings.length,
          unusedDependenciesCount: unusedCount,
          vulnerableDependenciesCount: vulnCount,
          reachableVulnerabilitiesCount: reachableVulnCount,
          healthScore,
        },
        deadCode: deadResult.deadCodeFindings,
        dependencies: depsFindings,
      };

      const outDir = path.resolve(opts.outDir);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const jsonPath = path.join(outDir, 'code-hygiene-report.json');
      const htmlPath = path.join(outDir, 'code-hygiene-report.html');

      generateJsonReport(report, jsonPath);
      generateHtmlReport(report, htmlPath);

      // Console output
      console.log(chalk.bold(`\nCodebase Health Score: `) + (healthScore >= 80 ? chalk.green(`${healthScore}/100`) : chalk.red(`${healthScore}/100`)));
      console.log(`Files: ${files.length} | Dead Code: ${chalk.red(deadResult.deadCodeFindings.length)} | Unused Deps: ${chalk.yellow(unusedCount)} | Vulnerabilities: ${chalk.red(vulnCount)} (${reachableVulnCount} Reachable)`);
      console.log(chalk.green(`\n✔ JSON Report: ${jsonPath}`));
      console.log(chalk.green(`✔ HTML Dashboard: ${htmlPath}\n`));

      if (opts.ci && healthScore < parseInt(opts.threshold, 10)) {
        console.error(chalk.red(`✖ CI Failure: Health score below threshold (${opts.threshold})`));
        process.exit(1);
      }
    });

  program.parse();
}

main();
