# Pre2prod

**One command. A sequence of expert reviews. A repository prepared for real staging.**

Pre2prod is a TypeScript CLI that uses Codex to improve an existing repository through a simple reviewer-led loop:

```text
persistent Reviewer
→ review a readiness phase
→ set Reviewer phase goal
→ fork a Worker when material gaps exist
→ set Worker plan/execution goals
→ Worker writes PRE2PROD_PLAN.md
→ Worker executes the plan
→ clear Worker goal between iterations/phases
→ Reviewer independently re-reviews the changed repository
```

## Status

This is a hackathon MVP scaffold. The orchestration, App Server client, prompts, Git checkpoints, Codex Skill, mocks, and automated tests are implemented. Live compatibility still needs to be verified against the installed Codex CLI version.

## Requirements

- Node.js 20+
- an installed and authenticated Codex CLI with `codex app-server`

## Install and run

```bash
pnpm install
pnpm run build
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

## Review Phases Configuration

Phase prompts are loaded in this order:

1. `<repo>/.pre2prod/phases.yaml`
2. `$HOME/.pre2prod/phases.yaml`
3. built-in `resources/phases.yaml`

`phases.yaml` supports a compact format where each phase is a YAML key and a multiline prompt:

```yaml
"Architecture and maintainability": |
  Review material architectural and maintainability risks.
  Look for coupling, hidden side effects, and oversized modules.

Security: |
  Review the security posture relevant to this project.
  Focus on exploitable or materially risky gaps.
```

`id` is derived from the key as slug (`Architecture and maintainability` → `architecture-and-maintainability`).

You can still use the full YAML format with `include`, `phases`, and object-style phase definitions when needed.

## CLI

```text
pre2prod [instructions...]

Options:
  -C, --cwd <path>            repository directory
  --model <model>             Codex model (default: gpt-5.6)
  --max-iterations <n>        worker iterations per phase (default: 2)
  --no-network                disable network for worker execution turns
  --codex-bin <path>          Codex executable
  -p, --phases <ids>          run only these phases (id or group prefix, comma-separated, can be repeated)
  -x, --exclude <ids>         exclude phases (id or group prefix, comma-separated, can be repeated)
  -l, --list                  list phases (after include/exclude filters) and exit
  --verbose                   show streamed model and command details
```

Examples:

```bash
# run only two phases
pre2prod -C . -p testing,security

# run all Architecture phases (prefix-based group selection)
pre2prod -C . -p architecture

# run all except security
pre2prod -x security

# run Foundation and Verification, but skip one verification phase
pre2prod -p foundation,verification -x verification-type-safety

# show final phase list after filters
pre2prod --list -p testing,security -x security

# list available phases in grouped view
pre2prod --list

Foundation
  Immediate Risk Triage        foundation-immediate-risk-triage
  Reproducible Local Run      foundation-reproducible-local-run
  Core Scope & Critical Journeys foundation-core-scope-critical-journeys
  Critical Smoke Baseline      foundation-critical-smoke-baseline
```

## Development

```bash
pnpm run validate
pnpm run pack:check
```

Current automated baseline:

- 13 tests across unit, Git, JSON-RPC, runtime, and full mock-pipeline coverage;
- approximately 81% line coverage on the tested core;
- successful TypeScript build and pnpm package dry run.

Tests include:

- Reviewer structured-output and fallback parsing;
- full pipeline state transitions with a fake runtime;
- App Server JSON-RPC integration against a mock subprocess;
- Git precondition and checkpoint commit behavior.

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

## Run `pre2prod` from any project

From the checked-out pre2prod repository:

```bash
pnpm run link
```

Now you can run directly from any repository:

```bash
cd /path/to/project
pre2prod --list
```

For one-off local runs without global install:

```bash
node dist/cli.js --list -C /path/to/project
```

## Safety boundaries

- noninteractive by design;
- no destructive production operations;
- no automatic stash/reset/clean;
- dirty or missing Git exits with a clear error and instruction to run `git init`;
- deployment readiness is prepared, not automatically promoted to production;
- the resulting repository still requires human review before production use.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/PRE2PROD_SPEC_RU.md`](docs/PRE2PROD_SPEC_RU.md), and [`HANDOFF.md`](HANDOFF.md).
