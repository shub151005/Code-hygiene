import fs from 'node:fs';
import path from 'node:path';
import { parseSourceFile } from './parser.js';
import { analyzeFileAST } from './call-graph.js';
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
/**
 * Resolves a relative import specifier to an absolute file path.
 * Handles TypeScript ESM syntax where `.js` in import maps to `.ts` on disk.
 */
export function resolveImportPath(importingFilePath, rawSource) {
    if (!rawSource.startsWith('.') && !rawSource.startsWith('/')) {
        return null; // External package
    }
    const dir = path.dirname(importingFilePath);
    let targetBasePath = path.resolve(dir, rawSource);
    // Exact file match
    if (fs.existsSync(targetBasePath) && fs.statSync(targetBasePath).isFile()) {
        return path.normalize(targetBasePath);
    }
    // Handle TS imports with .js extension mapping to .ts/.tsx
    const ext = path.extname(targetBasePath);
    if (ext) {
        const withoutExt = targetBasePath.slice(0, -ext.length);
        for (const testExt of ['.ts', '.tsx', '.js', '.jsx']) {
            const candidate = withoutExt + testExt;
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return path.normalize(candidate);
            }
        }
    }
    // Try appending extensions
    for (const e of EXTENSIONS) {
        const candidate = targetBasePath + e;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return path.normalize(candidate);
        }
    }
    // Try index files
    for (const e of EXTENSIONS) {
        const candidate = path.join(targetBasePath, `index${e}`);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return path.normalize(candidate);
        }
    }
    return null;
}
/**
 * Detects project entry points (package.json bin/main or index/app files).
 */
export function detectEntryPoints(projectRoot, filePaths) {
    const entryPoints = new Set();
    // Check package.json
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            const candidates = [
                pkg.main,
                pkg.module,
                typeof pkg.bin === 'string' ? pkg.bin : null,
                ...(pkg.bin && typeof pkg.bin === 'object' ? Object.values(pkg.bin) : []),
            ].filter(Boolean);
            for (const c of candidates) {
                const full = path.resolve(projectRoot, c);
                if (fs.existsSync(full) && fs.statSync(full).isFile()) {
                    entryPoints.add(path.normalize(full));
                }
                else {
                    for (const ext of EXTENSIONS) {
                        if (fs.existsSync(full + ext) && fs.statSync(full + ext).isFile()) {
                            entryPoints.add(path.normalize(full + ext));
                        }
                    }
                }
            }
        }
        catch {
            // Ignore invalid package.json
        }
    }
    // Common entry filenames
    for (const fp of filePaths) {
        const base = path.basename(fp).toLowerCase();
        if (base.startsWith('index.') ||
            base.startsWith('main.') ||
            base.startsWith('app.') ||
            base.startsWith('server.') ||
            base.startsWith('cli.')) {
            entryPoints.add(path.normalize(fp));
        }
    }
    return entryPoints;
}
/**
 * Scans a list of source files and identifies all dead code.
 */
export function scanForDeadCode(projectRoot, filePaths) {
    const fileAnalyses = new Map();
    const normalizedFiles = filePaths.map((f) => path.normalize(f));
    const entryPoints = detectEntryPoints(projectRoot, normalizedFiles);
    // 1. Parse and extract AST analysis for all files
    let totalFunctionsCount = 0;
    for (const filePath of normalizedFiles) {
        const parsed = parseSourceFile(filePath);
        if (!parsed.ast)
            continue;
        const analysis = analyzeFileAST(filePath, parsed.ast, projectRoot);
        fileAnalyses.set(filePath, analysis);
        for (const decl of analysis.declarations.values()) {
            if (decl.kind === 'function')
                totalFunctionsCount++;
        }
    }
    // 2. Track inbound file imports and cross-file symbol usage
    const fileInboundImports = new Map();
    const fileInboundSymbols = new Map();
    for (const [callerFile, analysis] of fileAnalyses.entries()) {
        for (const imp of analysis.imports) {
            if (!imp.isPackage) {
                const resolved = resolveImportPath(callerFile, imp.rawSource);
                if (resolved && fileAnalyses.has(resolved)) {
                    if (!fileInboundImports.has(resolved)) {
                        fileInboundImports.set(resolved, new Set());
                    }
                    fileInboundImports.get(resolved).add(callerFile);
                    if (!fileInboundSymbols.has(resolved)) {
                        fileInboundSymbols.set(resolved, new Set());
                    }
                    const importedSet = fileInboundSymbols.get(resolved);
                    for (const s of imp.importedSymbols) {
                        importedSet.add(s);
                    }
                }
            }
        }
    }
    const findings = [];
    const getLinePreview = (filePath, line) => {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split(/\r?\n/);
            return lines[line - 1]?.trim() || '';
        }
        catch {
            return '';
        }
    };
    // 3. Detect Orphan Files
    for (const filePath of normalizedFiles) {
        const isEntry = entryPoints.has(filePath);
        const inbound = fileInboundImports.get(filePath);
        // If never imported and not an entry point
        if (!isEntry && (!inbound || inbound.size === 0)) {
            const base = path.basename(filePath);
            if (base.includes('.test.') || base.includes('.spec.') || filePath.includes('__tests__')) {
                continue;
            }
            findings.push({
                type: 'orphan-file',
                name: path.relative(projectRoot, filePath),
                filePath,
                line: 1,
                column: 0,
                preview: getLinePreview(filePath, 1),
                confidence: 'high',
                suggestion: 'File is never imported anywhere in the project tree. Safe to remove or archive.',
            });
        }
    }
    // 4. Detect Unused Local Functions & Variables + Unused Exports
    for (const [filePath, analysis] of fileAnalyses.entries()) {
        const isEntry = entryPoints.has(filePath);
        const inboundSymbols = fileInboundSymbols.get(filePath) || new Set();
        for (const [name, decl] of analysis.declarations.entries()) {
            if (decl.isExported) {
                // If not an entry file, check if any importing file asks for this symbol
                if (!isEntry) {
                    const isImportedElsewhere = inboundSymbols.has(name) || inboundSymbols.has('*');
                    const isReferencedLocally = (analysis.internalReferences.get(name) || 0) > 0;
                    if (!isImportedElsewhere && !isReferencedLocally) {
                        findings.push({
                            type: 'unused-export',
                            name,
                            filePath,
                            line: decl.line,
                            column: decl.column,
                            preview: getLinePreview(filePath, decl.line),
                            confidence: 'high',
                            suggestion: `Exported ${decl.kind} '${name}' is never imported by any file or used internally.`,
                        });
                    }
                }
            }
            else {
                // Private / local symbol
                const refCount = analysis.internalReferences.get(name) || 0;
                if (refCount === 0) {
                    findings.push({
                        type: decl.kind === 'function' ? 'unused-function' : 'unused-variable',
                        name,
                        filePath,
                        line: decl.line,
                        column: decl.column,
                        preview: getLinePreview(filePath, decl.line),
                        confidence: 'high',
                        suggestion: `Unexported ${decl.kind} '${name}' is declared but never referenced or invoked.`,
                    });
                }
            }
        }
    }
    return {
        fileAnalyses,
        deadCodeFindings: findings,
        totalFunctionsCount,
    };
}
