# Pipeline implementation request for IBM Bob

Work in this repository as one agent. Do not spawn subagents or teams.

The existing Code Hygiene & Dependency Auditor is the product. Your task is to
create a small, repeatable pipeline connecting its existing components. Bob is
used to author the pipeline, not as a runtime dependency of every audit.

Read package.json, README.md, src/cli.ts, src/types.ts, and tests/audit.test.ts
first. Do not scan node_modules, dist, or .git. Preserve the existing product,
sample fixture, and historical reports at the repository root.

## Required result

1. A cross-platform local pipeline command that runs build, deterministic tests,
   and the compiled audit CLI sequentially. Reuse the CLI and both existing
   reporters rather than duplicating their logic. Accept a target directory,
   output directory, offline mode, and the existing quality gate options.
2. A convenient offline sample command using tests/fixtures/sample-app. Its
   default demonstration should generate reports successfully, while an explicit
   strict gate invocation should fail for this intentionally unhealthy fixture.
3. Write new reports and a compact pipeline summary (stage results, timings,
   overall result, and actual report locations) under artifacts by default.
   Preserve subprocess failures, stop on build/test failures, and retain audit
   reports when a quality gate fails. Avoid stale reports being reported as fresh.
4. One GitHub Actions workflow for push, pull_request, and workflow_dispatch.
   Use read-only repository permissions, install with npm ci, invoke the same
   local pipeline for an offline sample verification, and upload produced
   artifacts even on failure. Do not deploy, publish, push, or create a PR.
5. Reliable default tests: the current OSV tests use live internet. Mock OSV
   responses for default automated tests; retain an explicitly opt-in live check
   if useful. Do not silently skip the important assertions or require a Bob API
   key in CI. Add focused tests for pipeline failure propagation and quality-gate
   report retention where practical.
6. Document setup, offline demo, a real-project audit, strict gates, artifacts,
   and the limited role of Bob. Replace the old machine-specific setup path.
   Add sensible ignore rules for artifacts, build output, node_modules, and
   local secrets. Do not remove already tracked files or change Git history.

## Scope and validation

- Keep changes confined to pipeline scripts, workflow, documentation, ignore
  rules, package scripts, and necessary tests. Avoid analyzer feature work.
- Use the modular TypeScript CLI, not standalone-audit.js.
- Do not install new dependencies unless absolutely necessary.
- Never read or print credentials or user home configuration.
- Do not claim that an offline run verified vulnerabilities. Explain that
  current reachability means package import presence, not exploit reachability.
- Run the build, deterministic tests, and offline sample pipeline. Also verify
  an intentionally failing strict quality gate leaves JSON and HTML reports.
- Report files changed, commands tested, and limitations. Stop after local
  implementation and validation; do not commit or publish anything.
