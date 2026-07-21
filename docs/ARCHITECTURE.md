# Architecture

## Runtime graph

```text
Reviewer thread (persistent for the whole run)
  ├─ discovery turn
  ├─ phase review turn
  │    ├─ set thread goal for current review phase
  │    └─ fork Worker at this completed turn
  │          ├─ set Worker goal: plan
  │          ├─ planning turn writes PRE2PROD_PLAN.md
  │          ├─ set Worker goal: execute
  │          └─ execution turn implements the plan
  ├─ clear Worker goal between phases/iterations
  ├─ re-review turn on the original Reviewer thread
  ├─ clear Reviewer goal after each review pass/attempt
  └─ next phase
```

The Worker transcript never enters the Reviewer thread. The Reviewer sees only the changed workspace and retains its own high-level understanding of the project.

## Components

- `AppServerRuntime`: small typed subset of Codex App Server JSON-RPC over stdio.
- `Pre2prodPipeline`: explicit sequential orchestration.
- `phases.ts`: ordered reviewer prompts.
- `prompts.ts`: shared and role-specific instructions.
- `git.ts`: optional branch/checkpoint support; workflow does not depend on Git.
- `PRE2PROD_PLAN.md`: single plan file overwritten by each Worker iteration.

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

Before publishing, test against the exact installed Codex version. The Codex CLI can generate version-specific types with:

```bash
codex app-server generate-ts --out ./schemas
```
