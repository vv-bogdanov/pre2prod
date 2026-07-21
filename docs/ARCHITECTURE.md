# Architecture

## Runtime graph

```text
Reviewer thread (persistent for the whole run)
  ├─ discovery turn
  ├─ phase review turn
  │    └─ fork Worker at this completed turn
  │          ├─ planning turn returns the remediation plan
  │          ├─ CLI writes PRE2PROD_PLAN.md
  │          ├─ set Worker execution goal
  │          └─ execution turn implements the plan
  ├─ clear Worker goal after execution
  ├─ re-review turn on the original Reviewer thread
  └─ next phase
```

The Worker transcript never enters the Reviewer thread. The Reviewer sees only the changed workspace and retains its own high-level understanding of the project.

The App Server Worker fork is non-ephemeral because the goal API is unavailable
on ephemeral threads. It is still disposable in Pre2Prod: it is never resumed
or merged back into the Reviewer, and the App Server process closes at run end.

## Components

- `AppServerRuntime`: small typed subset of Codex App Server JSON-RPC over stdio.
- `Pre2prodPipeline`: explicit sequential orchestration.
- `phases.ts`: ordered reviewer prompts loaded from project, home, or bundled YAML.
- `prompts.ts`: shared and role-specific instructions.
- `git.ts`: required branch/checkpoint support; workflow requires running in a git repository.
- `PRE2PROD_PLAN.md`: transient plan file written by the CLI and archived after
  the phase.

## Protocol compatibility

The repository intentionally implements only the App Server methods it uses:

- `initialize` / `initialized`
- `thread/start`
- `thread/fork`
- `thread/goal/set`
- `thread/goal/get`
- `thread/goal/clear`
- `thread/goal/updated`
- `thread/goal/cleared`
- `turn/start`
- turn/item notifications

Before each release, test against the exact installed Codex version. The Codex
CLI can generate version-specific types with:

```bash
codex app-server generate-ts --out ./schemas
```
