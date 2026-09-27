export interface ParsedDependency {
    name: string;
    declaredVersion: string;
    resolvedVersion?: string;
    isDevDependency: boolean;
}
export interface ProjectManifest {
    name: string;
    version: string;
    dependencies: ParsedDependency[];
}
export declare function parseProjectManifest(projectRoot: string): ProjectManifest | null;
