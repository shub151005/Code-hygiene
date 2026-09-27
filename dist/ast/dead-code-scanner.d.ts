import { FileAnalysis } from './call-graph.js';
import type { DeadCodeFinding } from '../types.js';
/**
 * Resolves a relative import specifier to an absolute file path.
 * Handles TypeScript ESM syntax where `.js` in import maps to `.ts` on disk.
 */
export declare function resolveImportPath(importingFilePath: string, rawSource: string): string | null;
/**
 * Detects project entry points (package.json bin/main or index/app files).
 */
export declare function detectEntryPoints(projectRoot: string, filePaths: string[]): Set<string>;
/**
 * Scans a list of source files and identifies all dead code.
 */
export declare function scanForDeadCode(projectRoot: string, filePaths: string[]): {
    fileAnalyses: Map<string, FileAnalysis>;
    deadCodeFindings: DeadCodeFinding[];
    totalFunctionsCount: number;
};
