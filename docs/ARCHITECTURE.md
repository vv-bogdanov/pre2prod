# Architecture

## Runtime graph

```text
Reviewer thread (persistent for the whole run)
  ├─ discovery turn
  ├─ phase review turn
  │    └─ fork Worker at this completed turn
  │          ├─ planning turn writes PRE2PROD_PLAN.md
  │          └─ execution turn implements the plan
  ├─ re-review turn on the original Reviewer thread
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
- `turn/start`
- turn/item notifications

Before publishing, test against the exact installed Codex version. The Codex CLI can generate version-specific types with:

```bash
codex app-server generate-ts --out ./schemas
```
