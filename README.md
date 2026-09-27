# Code Hygiene & Dependency Auditor CLI

A developer tool that tackles codebase decay by identifying dead code (unused functions, unreferenced exports, and orphan files) and auditing dependencies for unused packages, outdated versions, and reachable security vulnerabilities.

---

## Architecture

```
code-hygiene-cli/
├── src/
│   ├── ast/
│   │   ├── parser.ts            # Parses TS/JS source files into ASTs
│   │   ├── call-graph.ts        # Builds symbol declaration & reference graph
│   │   └── dead-code-scanner.ts # Detects orphan files, unused exports, and dead functions
│   ├── dependencies/
│   │   ├── manifest-parser.ts   # Parses package.json (dependencies & devDependencies)
│   │   ├── unused-checker.ts    # Flags packages installed but never imported in source
│   │   └── osv-auditor.ts       # Queries OSV for CVEs & assesses import reachability
│   ├── reporter/
│   │   ├── json-reporter.ts     # Generates structured JSON report
│   │   └── html-reporter.ts     # Generates interactive HTML dashboard
│   ├── types.ts                 # Shared data models, findings, metrics
│   └── cli.ts                   # Runs scan, prints summary, invokes both reporters
├── tests/
│   ├── fixtures/
│   │   └── sample-app/          # Test fixture with dead code, unused and vulnerable deps
│   └── audit.test.ts            # Vitest unit and integration test suite
├── package.json
└── tsconfig.json
```

---

## Key Features

1. **Dead Code & Zombie Function Detection:**
   - **Orphan Files:** Files that exist in the repository but are never imported or referenced.
   - **Unused Exports:** Exported functions, classes, or constants that are never imported across the project.
   - **Dead Private Functions:** Functions declared inside a module that are never called locally.

2. **Dependency Hygiene & Reachability Analysis:**
   - **Unused Packages:** Dependencies declared in `package.json` that are never imported anywhere in the codebase.
   - **Vulnerability Audit (Google OSV):** Real-time lookup of CVEs and GitHub Security Advisories (GHSA).
   - **Reachability Check:** Differentiates between dependencies that are isolated vs. vulnerable dependencies that are actively imported into your application runtime.

3. **Dual Reporting:**
   - **`code-hygiene-report.json`:** Machine-readable JSON output for CI/CD gates and automation.
   - **`code-hygiene-report.html`:** Interactive standalone dashboard with circular health gauge, search filters, and severity tags.

4. **CI/CD Quality Gates:**
   - Supports `--ci`, `--threshold <score>`, `--fail-on-dead-code`, and `--fail-on-vuln` with automated exit code handling.

---

## Installation & Setup

```bash
cd "C:\Users\Dhrub Goyal\.gemini\antigravity\scratch\code-hygiene-cli"
npm install
npm run build
```

---

## Usage

### 1. Scan a Project (Generates Terminal Summary + JSON & HTML Reports)
```bash
npx tsx src/cli.ts path/to/project
```
Or with compiled binary:
```bash
node dist/cli.js path/to/project
```

### 2. Custom Output Directory
```bash
node dist/cli.js path/to/project --out-dir ./audit-results
```

### 3. CI/CD Mode (Exit with Code 1 on Violations)
```bash
node dist/cli.js path/to/project --ci --threshold 80 --fail-on-vuln
```

### 4. Fast Offline Mode (Skip Network CVE Calls)
```bash
node dist/cli.js path/to/project --skip-vulns
```

---

## Running Tests

```bash
npm test
```
Runs the full Vitest test suite testing AST parsing, call graph analysis, dead code detection, reachability, OSV lookups, and both reporters.
