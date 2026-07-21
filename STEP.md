# Manual Flight Plan

## Goal

Run every Pre2prod phase against this repository in reviewed waves with
automatic per-phase checkpoint commits. Each wave shares one persistent
Reviewer and discovery pass. After a wave, inspect its commits and logs, write
reports with recommendations, fix confirmed Pre2prod bugs or maintenance
friction, and merge the accepted wave back into the dogfood branch. Finish with
a consolidated report and recommendations for the CLI's MVP scope.

## Rules

- Keep `main` clean; use `dogfood/pre2prod-sota` as the reviewed integration
  branch.
- Start each wave without `--no-commit`; Pre2prod creates its own
  `pre2prod/<timestamp>` wave branch and commits every passed phase. Use
  `--max-iterations 1` unless a rule below overrides it.
- Run the remaining Operations phases and all Assurance and Delivery phases
  with the standard Codex provider/model and `--max-iterations 2` to close a
  second confirmed remediation cycle without a manual rerun.
- Run only selected, unfinished phases in a logical group per wave. The
  persistent Reviewer performs discovery once and stays alive across that wave.
- Do not start a later wave until the current wave's commits, logs, reports,
  and merge decision are reviewed.
- Wait for an agent turn to complete instead of polling its status. If a
  progress check is necessary, perform it no more often than once every
  15 minutes.
- If a wave stops on a failed phase, preserve its root Worker plan and diff,
  inspect them before deciding whether to fix and rerun the phase.
- Treat non-applicable phases as an evidence-based PASS, not a reason to add
  irrelevant product features.
- Keep phase reports and the final report outside product commits unless a
  report becomes intentional repository documentation.
- Store reports in `.pre2prod/reports/`. The CLI archives successful Worker
  plans in `.pre2prod/plans`; preserve failed-phase root plans in reports before
  modifying or removing them.
- At the user's direction, the final Operations/Assurance and Delivery phases
  were reviewed and remediated manually on `main` after automated waves stopped.

## Preparation

- [x] Create and switch to the dedicated flight branch.
- [x] Confirm a clean working tree and record the baseline commit.
- [x] Run `pnpm run check`.
- [x] Run `pnpm run build`.
- [x] Confirm the phase list with `pre2prod --list`.
- [x] Prepare a report entry for each phase with: phase, slug, run ID, model,
      outcome, reviewer findings, Worker actions, changed files, validation,
      tool issues, recommendations, and commit decision.

## Wave Procedure

- [x] Start a wave from the clean dogfood branch with its selected phase group,
      the configured model and iteration limit, and without `--no-commit`.
- [x] Record the wave branch, run ID, model/provider, selected phases, and
      result.
- [x] If it passes, inspect each checkpoint commit, `git diff` from the wave
      base, archived plans, and summary/full logs grouped by phase and turn.
- [x] Independently verify material Worker claims and run validation relevant to
      the combined wave diff.
- [x] Write one ignored report per phase from its commit and logs, including
      recommendations and the commit decision.
- [x] Rebuild the CLI after accepting the wave, then merge it into the dogfood
      branch before the next wave.
- [x] If it stops, inspect the failing phase's root plan, diff, and logs; fix
      confirmed Pre2prod bugs with focused tests and rerun that phase before
      resuming the wave plan.

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

- [x] `correctness-type-safety` — Type Safety
- [x] `correctness-runtime-contracts` — Runtime Contracts
- [x] `correctness-error-handling` — Error Handling
- [x] `correctness-failure-diagnostics` — Failure Diagnostics
- [x] `correctness-data-integrity-migrations` — Data Integrity & Migrations

### Product

- [x] `product-ux-completeness` — UX Completeness
- [x] `product-accessibility` — Accessibility

### Verification

- [x] `verification-core-unit-invariants` — Core Unit & Invariants
- [x] `verification-integration` — Integration
- [x] `verification-contracts-compatibility` — Contracts & Compatibility
- [x] `verification-end-to-end-critical-journeys` — End-to-End Critical Journeys
- [x] `verification-test-suite-quality-stability` — Test Suite Quality & Stability
- [x] `verification-static-analysis-formatting` — Static Analysis & Formatting

### Operations

- [x] `operations-observability` — Observability
- [x] `operations-reliability-operability` — Reliability & Operability
- [x] `operations-performance-resource-efficiency` — Performance & Resource Efficiency

### Assurance

- [x] `assurance-application-security-hardening` — Application Security Hardening
- [x] `assurance-privacy-sensitive-data` — Privacy & Sensitive Data
- [x] `assurance-legal-compliance-readiness` — Legal & Compliance Readiness

### Delivery

- [x] `delivery-ci-quality-gates` — CI Quality Gates
- [x] `delivery-release-artifact-integrity` — Release Artifact Integrity
- [x] `delivery-secure-supply-chain` — Secure Supply Chain
- [x] `delivery-deployment-readiness` — Deployment Readiness
- [x] `delivery-staging-verification` — Staging Verification
- [x] `delivery-documentation-repository` — Documentation & Repository

## Final Review

- [x] Read every phase report and compare repeated findings across phases.
- [x] Review all fixes made to Pre2prod during the flight.
- [x] Run `pnpm run validate`.
- [x] Produce a consolidated report covering pipeline correctness, Git safety,
      observability, diagnostics, phase and prompt quality, test gaps,
      documentation, and deferred work.
- [x] Prioritize final recommendations by demonstrated risk and repeated evidence.
