# Pre2prod

**One command. A sequence of expert reviews. A repository prepared for real staging.**

Pre2prod is a TypeScript CLI that uses Codex to improve an existing repository through a simple reviewer-led loop:

```text
persistent Reviewer
→ review a readiness phase
→ fork a Worker when material gaps exist
→ Worker writes PRE2PROD_PLAN.md
→ Worker executes the plan
→ Reviewer independently re-reviews the changed repository
```

## Status

This is a hackathon MVP scaffold. The orchestration, App Server client, prompts, Git checkpoints, Codex Skill, mocks, and automated tests are implemented. Live compatibility still needs to be verified against the installed Codex CLI version.

## Requirements

- Node.js 20+
- an installed and authenticated Codex CLI with `codex app-server`

## Install and run

```bash
npm install
npm run build
node dist/cli.js
```

After publishing:

```bash
npx --yes pre2prod
```

Optional free-form direction:

```bash
npx --yes pre2prod \
  "Prefer Railway, preserve the monolith, and avoid paid services"
```

## CLI

```text
pre2prod [instructions...]

Options:
  -C, --cwd <path>          repository directory
  --model <model>           Codex model (default: gpt-5.6)
  --max-iterations <n>      worker iterations per phase (default: 2)
  --no-network              disable network for execution turns
  --codex-bin <path>        Codex executable
  --verbose                 stream model and command details
```

## Development

```bash
npm run validate
npm run pack:check
```

Current automated baseline:

- 13 tests across unit, Git, JSON-RPC, runtime, and full mock-pipeline coverage;
- approximately 81% line coverage on the tested core;
- successful TypeScript build and npm package dry run.

Tests include:

- Reviewer structured-output and fallback parsing;
- full pipeline state transitions with a fake runtime;
- App Server JSON-RPC integration against a mock subprocess;
- optional Git branch/checkpoint behavior.

## Codex Skill

The repo includes an explicit-only skill at:

```text
.agents/skills/pre2prod/
```

Invoke it in Codex with:

```text
$pre2prod
```

The skill only launches the CLI; it does not duplicate the workflow.

## Safety boundaries

- noninteractive by design;
- no destructive production operations;
- no automatic stash/reset/clean;
- dirty or missing Git disables automatic checkpoints;
- deployment readiness is prepared, not automatically promoted to production;
- the resulting repository still requires human review before production use.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/PRE2PROD_SPEC_RU.md`](docs/PRE2PROD_SPEC_RU.md), and [`HANDOFF.md`](HANDOFF.md).
