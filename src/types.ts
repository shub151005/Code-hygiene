export type DeadCodeType = 'orphan-file' | 'unused-export' | 'unused-function' | 'unused-variable';

export interface DeadCodeFinding {
  type: DeadCodeType;
  name: string;
  filePath: string;
  line: number;
  column: number;
  preview?: string;
  confidence: 'high' | 'medium';
  suggestion: string;
}

export interface VulnerabilityInfo {
  id: string; // e.g., GHSA-xxxx-xxxx or CVE-xxxx-xxxx
  summary: string;
  details?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  fixedVersion?: string;
  referenceUrl?: string;
}

export type DependencyStatus = 'clean' | 'unused' | 'vulnerable' | 'outdated';

export interface DependencyFinding {
  packageName: string;
  declaredVersion: string;
  resolvedVersion?: string;
  isDevDependency: boolean;
  status: DependencyStatus;
  isReachable: boolean; // Is this package actually imported anywhere in user code?
  importedInFiles: string[];
  vulnerabilities: VulnerabilityInfo[];
  upgradeSuggestion?: string;
}

export interface CodebaseMetrics {
  totalFilesScanned: number;
  totalFunctionsAnalyzed: number;
  totalDependencies: number;
  deadCodeCount: number;
  unusedDependenciesCount: number;
  vulnerableDependenciesCount: number;
  reachableVulnerabilitiesCount: number;
  healthScore: number; // 0 - 100
}

export interface AuditReport {
  timestamp: string;
  targetDirectory: string;
  metrics: CodebaseMetrics;
  deadCode: DeadCodeFinding[];
  dependencies: DependencyFinding[];
}

export interface AuditOptions {
  cwd: string;
  ignorePatterns?: string[];
  format?: 'terminal' | 'json' | 'html';
  outputFile?: string;
  ci?: boolean;
  minHealthScore?: number;
  failOnDeadCode?: boolean;
  failOnVuln?: boolean;
  skipVulnerabilityCheck?: boolean;
}
