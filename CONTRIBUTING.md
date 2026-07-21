# Contributing

Pre2Prod is intentionally a small TypeScript CLI. Changes should preserve the
Reviewer/Worker flow and the KISS/YAGNI constraints in `AGENTS.md`.

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

## Before a pull request

Run the same release gate as CI:

```bash
pnpm run release:check
```

Keep changes focused and add behavioral tests for orchestration, protocol,
prompt, or Git-safety changes. Do not add snapshots for terminal formatting or
unrelated framework abstractions. Update the live compatibility checklist when
the supported Codex App Server subset changes.

Report vulnerabilities privately according to `SECURITY.md`; never place
credentials or private repository content in a public issue or test fixture.
