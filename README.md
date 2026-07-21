# Pre2prod

**One command. A sequence of expert reviews. A repository prepared for real staging.**

Pre2prod is a TypeScript CLI that uses Codex to improve an existing repository through a simple reviewer-led loop:

```text
persistent Reviewer
→ review a readiness phase
→ fork a Worker when material gaps exist
→ Worker writes PRE2PROD_PLAN.md
→ set Worker execution goal
→ Worker executes the plan and completes the goal
→ Reviewer independently re-reviews the changed repository
```

## Status

This is a hackathon MVP scaffold. The orchestration, App Server client, prompts, Git checkpoints, explicit-only Codex Skill at `.agents/skills/pre2prod/`, mocks, and automated tests are implemented. Live compatibility still needs to be verified against the installed Codex CLI version.

## Requirements

- Node.js >=20.19.0
- Corepack-managed pnpm 10.14.0 (the version pinned in `packageManager`)
- an installed and authenticated Codex CLI with `codex app-server`

## Install and run

```bash
corepack enable
pnpm install --frozen-lockfile
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

````text
pre2prod [instructions...]

Options:
  -C, --cwd <path>            repository directory
  --model <model>             Codex model (defaults to Codex CLI setting)
  --local-provider <provider> run Codex with a local provider (ollama or lmstudio)
  --max-iterations <n>        worker iterations per phase (default: 2)
  --no-network                disable network for worker execution turns
  --no-commit                 run in the current branch without checkpoint commits
  --codex-bin <path>          Codex executable
  -p, --phases <ids>          run only these phases (id or group prefix, comma-separated, can be repeated)
  -x, --exclude <ids>         exclude phases (id or group prefix, comma-separated, can be repeated)
  -l, --list                  list phases (after include/exclude filters) and exit
  -o, --observe               stream reviewer/worker thinking, tools, and file changes (enabled by default)
  --verbose                   show streamed model and command details
  --dev                       rebuild from TypeScript before running (development mode)

In a local source checkout (`.git`, `src/`), pre2prod rebuilds automatically before each run.
For installed/prod usage, no rebuild occurs.

Use `--dev` to force rebuild explicitly (or `PRE2PROD_DEV=1` as legacy override):

```bash
pre2prod -C . -o --max-iterations 1
````

In a source checkout, `dev.env` configures the default development provider and model. It is loaded only for dev mode, so installed and normal runs keep Codex defaults. CLI flags override `dev.env`.

For a local Ollama run, Pre2prod starts Codex as `codex --oss --local-provider ollama app-server`.

```bash
pre2prod --local-provider ollama -p foundation-immediate-risk-triage
```

`pre2prod logs` reads run logs in `.pre2prod/logs` (or `--log-dir` override):

```text
pre2prod logs [options]

Options:
  --full                     Read full event log instead of summary log
  -r, --run-id <id>          Filter by run id (exact)
  -p, --phase-id <id>        Filter by phase id (substring)
  -i, --iteration <number>   Filter by phase iteration
  -R, --role <role>          Filter by thread role: reviewer|worker
  -t, --turn <turn>          Filter by phase turn: review|planning|execution
  -e, --event <event>        Filter by event name
  -c, --contains <text>      Filter by text in raw log line
  -T, --tag <tag>            Filter by text in contextTag
```

Examples:

```bash
# run only two phases
pre2prod -C . -p testing,security

# run all Architecture phases (prefix-based group selection)
pre2prod -C . -p architecture

# run one phase, review the diff, and commit manually
pre2prod -p foundation-immediate-risk-triage --no-commit

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

# quick grep-like log checks
pre2prod logs --event phase.review.blockers --phase-id architecture
pre2prod logs --full --tag p=3/12 --run-id 2026-07-21-...
```

## Development

```bash
pnpm run validate
pnpm run pack:check
```

Current automated baseline:

- formatting, typechecking, linting, test coverage, and TypeScript build;
- package-content verification with the repository's pinned pnpm version.

Tests include:

- Reviewer structured-result parsing;
- full pipeline state transitions with a fake runtime;
- App Server JSON-RPC integration against a mock subprocess;
- Git precondition and checkpoint commit behavior.

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

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/PREPROD_SPEC_RU.md`](docs/PREPROD_SPEC_RU.md), and [`HANDOFF.md`](HANDOFF.md).
