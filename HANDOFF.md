# Coding-agent handoff

The starter implementation is complete and validated against a mock Codex App Server.

## What is already implemented

- TypeScript CLI with Commander;
- one persistent Reviewer thread;
- ordered readiness phases;
- structured Reviewer results with `blockers` and `non_blockers`;
- Worker fork from the exact completed review turn;
- planning turn that writes `PRE2PROD_PLAN.md`;
- execution turn in the same Worker thread;
- re-review in the original Reviewer thread;
- finite per-phase iteration limit;
- noninteractive approval policy;
- required Git branch and checkpoint commits (run fails with `git init` instruction when repo is missing).
- explicit-only Codex Skill at `.agents/skills/pre2prod/` that delegates to the CLI;
- unit, integration, JSONL protocol, Git, and full mock pipeline tests;
- pnpm build and package validation.

## Required next step

Verify the implementation against the exact Codex CLI version used for the hackathon.

1. Install and authenticate Codex CLI.
2. Run `codex --version` and record the version.
3. Generate matching protocol types:

   ```bash
   pnpm run codex:schemas
   ```

4. Compare the generated types with the intentionally small protocol subset in `src/app-server/`.
5. Run Pre2prod on a disposable, underprepared repository.
6. Confirm the real session graph:
   - one persistent Reviewer;
   - Worker forked with `lastTurnId`;
   - planning writes only `PRE2PROD_PLAN.md`;
   - execution changes the repository;
   - Reviewer does not receive Worker transcript;
   - re-review sees current files and can return `PASS`.
7. Inspect App Server warnings, command events, file changes, failures, and interruptions.
8. Adjust only concrete protocol mismatches found in the live run.

## Commands

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run validate
pnpm run build
node dist/cli.js --help
```

Live smoke test:

```bash
node dist/cli.js -C /path/to/disposable/repository --verbose
```

## Scope discipline

Do not add a workflow framework, database, web UI, MCP layer, adapter matrix, or additional agent roles before the live vertical path is reliable.
