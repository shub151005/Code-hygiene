import { FileAnalysis } from '../ast/call-graph.js';
import { ParsedDependency } from './manifest-parser.js';
export interface PackageImportMap {
    [packageName: string]: Set<string>;
}
/**
 * Aggregates all package imports across analyzed source files.
 */
export declare function buildPackageImportMap(fileAnalyses: Map<string, FileAnalysis>): PackageImportMap;
/**
 * Checks dependencies against package imports to identify unused packages.
 */
export declare function checkUnusedDependencies(dependencies: ParsedDependency[], packageImportMap: PackageImportMap): {
    unusedDependencies: ParsedDependency[];
    packageUsage: Map<string, {
        isUsed: boolean;
        importedInFiles: string[];
    }>;
};
