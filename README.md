# Code Hygiene & Dependency Auditor CLI

A developer tool that tackles codebase decay by identifying dead code (unused
functions, unreferenced exports, and orphan files) and auditing dependencies for
unused packages and known vulnerabilities, with package import information.

---

## Architecture

```
code-hygiene-cli/
├── src/
│   ├── ast/
│   │   ├── parser.ts            # Parses TS/JS source files into ASTs
│   │   ├── call-graph.ts        # Builds symbol declaration & reference graph
│   │   └── dead-code-scanner.ts # Detects orphan files, unused exports, dead functions
│   ├── dependencies/
│   │   ├── manifest-parser.ts   # Parses package.json (dependencies & devDependencies)
│   │   ├── unused-checker.ts    # Flags packages installed but never imported in source
│   │   └── osv-auditor.ts       # Queries OSV for CVEs & assesses import reachability
│   ├── reporter/
│   │   ├── json-reporter.ts     # Generates structured JSON report
│   │   └── html-reporter.ts     # Generates interactive HTML dashboard
│   ├── types.ts                 # Shared data models, findings, metrics
│   └── cli.ts                   # Runs scan, prints summary, invokes both reporters
├── scripts/
│   └── pipeline.ts              # Local pipeline: build → test → audit
├── tests/
│   ├── fixtures/
│   │   └── sample-app/          # Intentionally unhealthy fixture for demos and tests
│   └── audit.test.ts            # Vitest suite with mocked OSV; live check is opt-in
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI workflow
├── package.json
└── tsconfig.json
```

---

## Key Features

1. **Dead Code & Zombie Function Detection**
   - **Orphan Files:** Files that exist in the repository but are never imported or referenced.
   - **Unused Exports:** Exported functions, classes, or constants that are never imported.
   - **Dead Private Functions:** Functions declared inside a module that are never called locally.

2. **Dependency Hygiene & Reachability Analysis**
   - **Unused Packages:** Dependencies declared in `package.json` but never imported.
   - **Vulnerability Audit (Google OSV):** Real-time lookup of CVEs and GitHub Security Advisories (GHSA).
   - **Reachability:** Differentiates isolated dependencies from vulnerable packages that are actively imported.
   > **Note on reachability:** "reachable" here means the package is present in an `import` statement
   > in the scanned source files. It does **not** mean the vulnerable code path is exercised at runtime
   > (exploit reachability). Treat it as a triage signal, not a definitive proof of exploitability.

3. **Dual Reporting**
   - **`code-hygiene-report.json`:** Machine-readable output for CI/CD gates and automation.
   - **`code-hygiene-report.html`:** Interactive standalone dashboard with circular health gauge,
     search filters, and severity tags.

4. **CI/CD Quality Gates**
   - `--ci`, `--threshold <score>`, `--fail-on-dead-code`, `--fail-on-vuln` with automated exit codes.

5. **Repeatable Local Pipeline**
   - `scripts/pipeline.ts` chains build → deterministic tests → audit in one command.
   - Writes a compact `artifacts/pipeline-summary.json` with stage timings and report locations.
   - Each run has its own directory; earlier reports are preserved.
   - Build/typecheck/test failures stop the pipeline and produce a fresh failure summary.

---

## Setup

Requires Node.js 22 or later and npm. Install dependencies once with internet access:

```bash
git clone https://github.com/shub151005/Code-hygiene.git code-hygiene-cli
cd code-hygiene-cli
npm ci
npm run build
```

No global installs are required to run the pipeline. Build and test tools are
resolved from local dependencies and executed directly with Node.

---

## Offline Demo (sample fixture)

Run the full pipeline against the built-in intentionally unhealthy sample fixture
without any internet access:

```bash
# Default demo — pipeline passes, reports written to artifacts/
npm run sample
```

Reports land in a unique `artifacts/run-<timestamp>-<id>/` directory alongside
its summary. `artifacts/pipeline-summary.json` points to the latest run's files.
The sample's offline health score is **81/100**: five dead-code findings and one
unused dependency. Vulnerability queries are **skipped**, not verified clean.

```bash
# Strict gate demo — pipeline exits 1 (fixture is intentionally unhealthy)
npm run sample:strict

# Check that the failure was the audit gate and that reports were retained
npm run sample:verify-gate
```

Even though the strict invocation exits with code 1, the JSON and HTML reports
are **retained** under `artifacts/`. Inspect them to see exactly what triggered
the gate.

---

## Auditing a Real Project

```bash
# Terminal summary + JSON & HTML reports in ./artifacts
npm run pipeline -- path/to/your-project --out-dir artifacts

# Skip network CVE calls (fast, offline)
npm run pipeline -- path/to/your-project --offline --out-dir artifacts

# Full quality gate (CI mode)
npm run pipeline -- "path/to/your-project" --ci --threshold 80 --fail-on-vuln --out-dir artifacts
```

Or use the compiled CLI directly:

```bash
node dist/cli.js path/to/your-project --out-dir ./audit-results
node dist/cli.js path/to/your-project --ci --threshold 80 --fail-on-vuln
node dist/cli.js path/to/your-project --skip-vulns
```

---

## Quality Gates Reference

| Flag | Description |
|---|---|
| `--ci` | Enable quality gate mode; exits 1 on failure |
| `--threshold <n>` | Minimum health score (0–100, default `70`) |
| `--fail-on-dead-code` | Fail if any dead code is detected |
| `--fail-on-vuln` | Fail if any vulnerable dependency is found |
| `--skip-vulns` / `--offline` | Skip network CVE calls |

In the pipeline, setting a threshold or a fail-on flag automatically enables
gates. Thresholds must be integers from 0 to 100. An offline vulnerability gate
is rejected because it cannot check vulnerabilities. The underlying direct CLI
still requires `--ci` for its gates.

The build and tests validate **this auditor**, not the application being scanned.
Findings are review suggestions; the pipeline does not modify the target project.

---

## Pipeline Artifacts

After `npm run sample` or `npm run pipeline`, the `artifacts/` directory contains:

```
artifacts/
├── pipeline-summary.json       # Latest normal pipeline run
├── run-<timestamp>-<id>/
│   ├── code-hygiene-report.json
│   ├── code-hygiene-report.html
│   └── pipeline-summary.json   # Statuses, exit codes, timings, report paths
└── gate-check-<id>/            # Separate strict-gate verification runs
```

`artifacts/` is listed in `.gitignore` and is never committed.

---

## Running Tests

```bash
npm test
```

Default tests are **offline**: OSV network calls are intercepted by
`vi.stubGlobal('fetch', …)` inside the test suite so no internet access is
required in CI.

To opt into live OSV network checks (useful for manual verification):

```bash
CI_LIVE_OSV=1 npm test
```

PowerShell: `$env:CI_LIVE_OSV='1'; npm test; Remove-Item Env:CI_LIVE_OSV`.
Pipeline test stages always disable live tests, even if this variable is set.

---

## GitHub Actions CI

The workflow at [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on
every push, pull request, and manual trigger. It:

1. Installs dependencies with `npm ci` on Windows and Linux using Node 22.
2. Runs `npm run sample` (offline pipeline — must pass).
3. Runs `npm run sample:verify-gate`, which checks the strict pipeline exits 1
   specifically at the audit stage and retains both reports.
4. Uploads the contents of `artifacts/` as a workflow artifact **even on failure**.

The workflow uses `permissions: contents: read` only. It does not deploy,
publish, push, or create pull requests.

---

## Role of Bob (IBM Bob)

Bob was used as an **authoring assistant** to design and write this pipeline.
Bob is **not** a runtime dependency of the auditor itself. Every script here is
plain TypeScript/Node.js and runs without any Bob API key, CLI, or service.

The initial draft was generated in a single IBM Bob Shell 2.0.5 session with
subagents and MCP disabled, using [the saved task instructions](docs/bob-pipeline-prompt.md).
Codex reviewed and corrected subprocess handling, artifact isolation, argument
validation, and automated verification. No additional agents or teams were used.

To ask Bob to extend the pipeline later, run `bob chat --disable-subagents --disable-mcp`
from this folder and reference the saved instructions. Bob authentication is
needed for authoring only. See [IBM's installation guide](https://bob.ibm.com/docs/shell/getting-started/install-and-setup).

## Existing analyzer limitations

Dead-code detection is heuristic and should not be used to delete code without
review. Dependency analysis covers dependencies declared in the root manifest,
not a full transitive dependency audit. The current OSV client returns no findings
on network errors, so an online run is recorded as `REQUESTED`, not confirmed
complete. Review live security results before treating a passing gate as assurance.
These analyzer behaviors are unchanged by the pipeline.
