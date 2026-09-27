import type { DependencyFinding, VulnerabilityInfo } from '../types.js';
import type { ParsedDependency } from './manifest-parser.js';
/**
 * Queries Google OSV API for a single package version.
 */
export declare function queryOSV(packageName: string, version: string): Promise<VulnerabilityInfo[]>;
/**
 * Audits all project dependencies concurrently against OSV and computes reachability.
 */
export declare function auditDependencies(dependencies: ParsedDependency[], packageUsage: Map<string, {
    isUsed: boolean;
    importedInFiles: string[];
}>, skipNetwork?: boolean): Promise<DependencyFinding[]>;
