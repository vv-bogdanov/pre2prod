# Manual Flight Plan

## Goal

Run every Pre2prod phase against this repository, one phase at a time, without
automatic checkpoint commits. After each run, inspect the diff and logs, write
a report with recommendations, fix confirmed Pre2prod bugs or maintenance
friction, and only then move to the next phase. Finish with a consolidated
report and recommendations for bringing the CLI to an appropriate state of the
art for its MVP scope.

## Rules

- Keep `main` clean; run the campaign from one dedicated working branch.
- Use `--no-commit` for every phase run.
- Run one phase only; never continue automatically to the next phase.
- Wait for an agent turn to complete instead of polling its status. If a
  progress check is necessary, perform it no more often than once every
  30 minutes.
- Do not discard a Worker diff without an explicit decision after review.
- Treat non-applicable phases as an evidence-based PASS, not a reason to add
  irrelevant product features.
- Keep phase reports and the final report outside product commits unless a
  report becomes intentional repository documentation.
- Store reports in `.pre2prod/reports/`; after reviewing a Worker plan,
  preserve a copy there and remove `PRE2PROD_PLAN.md` from the repository root
  before the next clean-start run.

## Preparation

- [x] Create and switch to the dedicated flight branch.
- [x] Confirm a clean working tree and record the baseline commit.
- [x] Run `pnpm run check`.
- [x] Run `pnpm run build`.
- [x] Confirm the phase list with `pre2prod --list`.
- [x] Prepare a report entry for each phase with: phase, slug, run ID, model,
      outcome, reviewer findings, Worker actions, changed files, validation,
      tool issues, recommendations, and commit decision.

## Per-Phase Procedure

- [ ] Run `pre2prod -p <phase-slug> --no-commit --max-iterations 1`.
- [ ] Record the run ID, model/provider, branch, and elapsed result.
- [ ] Inspect `git status`, `git diff --check`, `git diff --stat`, and full
      `git diff`.
- [ ] Inspect `PRE2PROD_PLAN.md` when a Worker ran.
- [ ] Inspect summary and full logs filtered by run ID, role, and turn.
- [ ] Verify the commands and checks claimed by the Worker independently when
      relevant.
- [ ] Write the phase report and recommendations.
- [ ] If the change is acceptable, archive or remove `PRE2PROD_PLAN.md` as
      appropriate and commit the reviewed change manually.
- [ ] Rebuild the CLI with `pnpm run build` after every accepted phase and
      before starting the next one.
- [ ] If Pre2prod itself has a confirmed bug or harmful maintenance friction,
      fix it with focused tests, validate it, and rerun the same phase.
- [ ] If the Worker change is not acceptable, stop and decide the next action
      before modifying or discarding it.

## Phase Flight

### Foundation

- [x] `foundation-immediate-risk-triage` — Immediate Risk Triage
- [x] `foundation-reproducible-local-run` — Reproducible Local Run
- [x] `foundation-core-scope-critical-journeys` — Core Scope & Critical Journeys
- [x] `foundation-critical-smoke-baseline` — Critical Smoke Baseline

### Architecture

- [x] `architecture-system-shape-dependency-boundaries` — System Shape & Dependency Boundaries
- [x] `architecture-data-model-persistence` — Data Model & Persistence
- [x] `architecture-dead-code-dependency-cleanup` — Dead Code & Dependency Cleanup
- [x] `architecture-simplification-deduplication` — Simplification & Deduplication

### Correctness

- [ ] `correctness-type-safety` — Type Safety
- [ ] `correctness-runtime-contracts` — Runtime Contracts
- [ ] `correctness-error-handling` — Error Handling
- [ ] `correctness-failure-diagnostics` — Failure Diagnostics
- [ ] `correctness-data-integrity-migrations` — Data Integrity & Migrations

### Product

- [ ] `product-ux-completeness` — UX Completeness
- [ ] `product-accessibility` — Accessibility

### Verification

- [ ] `verification-core-unit-invariants` — Core Unit & Invariants
- [ ] `verification-integration` — Integration
- [ ] `verification-contracts-compatibility` — Contracts & Compatibility
- [ ] `verification-end-to-end-critical-journeys` — End-to-End Critical Journeys
- [ ] `verification-test-suite-quality-stability` — Test Suite Quality & Stability
- [ ] `verification-static-analysis-formatting` — Static Analysis & Formatting

### Operations

- [ ] `operations-observability` — Observability
- [ ] `operations-reliability-operability` — Reliability & Operability
- [ ] `operations-performance-resource-efficiency` — Performance & Resource Efficiency

### Assurance

- [ ] `assurance-application-security-hardening` — Application Security Hardening
- [ ] `assurance-privacy-sensitive-data` — Privacy & Sensitive Data
- [ ] `assurance-legal-compliance-readiness` — Legal & Compliance Readiness

### Delivery

- [ ] `delivery-ci-quality-gates` — CI Quality Gates
- [ ] `delivery-release-artifact-integrity` — Release Artifact Integrity
- [ ] `delivery-secure-supply-chain` — Secure Supply Chain
- [ ] `delivery-deployment-readiness` — Deployment Readiness
- [ ] `delivery-staging-verification` — Staging Verification
- [ ] `delivery-documentation-repository` — Documentation & Repository

## Final Review

- [ ] Read every phase report and compare repeated findings across phases.
- [ ] Review all fixes made to Pre2prod during the flight.
- [ ] Run `pnpm run validate`.
- [ ] Produce a consolidated report covering pipeline correctness, Git safety,
      observability, diagnostics, phase and prompt quality, test gaps,
      documentation, and deferred work.
- [ ] Prioritize final recommendations by demonstrated risk and repeated evidence.
