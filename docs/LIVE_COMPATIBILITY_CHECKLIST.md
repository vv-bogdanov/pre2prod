# Live Codex compatibility checklist

The automated suite validates orchestration against a protocol-faithful mock process. These checks require a real authenticated Codex installation.

- [x] Record `codex --version` (confirmed locally: `codex-cli 0.144.6`).
- [x] Generate the installed CLI's TypeScript bindings and compare the used
      subset. `initialize` requires `capabilities`; read-only and workspace-write
      turn sandbox policies require explicit network and workspace exclusion
      fields. The adapter sends those fields.
- [ ] Run the live checks below on a host where Codex can create Linux user
      namespaces for Bubblewrap. On 2026-07-21, a direct local launch with a
      temporary Codex home initialized state files but stopped before JSON-RPC with
      `Codex's Linux sandbox uses bubblewrap and needs access to create user
namespaces.` No credentials or repository files were used by that probe.
- [ ] Run `pnpm run validate` on that normal host. In this managed sandbox, 47
      tests passed but the six subprocess-transport tests received immediate
      successful exits from nested Node processes, so they cannot validate the
      JSON-RPC client here.
- [ ] Confirm `codex app-server` starts over stdio.
- [ ] Confirm `initialize` and `initialized` handshake.
- [ ] Confirm `thread/start` accepts `cwd`, `approvalPolicy`, `sandbox`, and `serviceName`.
- [ ] Confirm Reviewer turns run under read-only sandbox.
- [ ] Confirm `outputSchema` produces parseable Reviewer JSON.
- [ ] Confirm `thread/fork` accepts `lastTurnId` for a non-ephemeral Worker.
- [ ] Confirm `thread/goal/set` endpoint shape.
- [ ] Confirm `thread/goal/get` endpoint shape.
- [ ] Confirm `thread/goal/clear` endpoint shape.
- [ ] Confirm `thread/goal/updated` notification shape.
- [ ] Confirm `thread/goal/cleared` notification shape.
- [ ] Confirm planning turn writes `PRE2PROD_PLAN.md`.
- [ ] Confirm execution turn receives workspace-write and configured network access.
- [ ] Confirm original Reviewer thread can continue after Worker completion.
- [ ] Confirm Worker transcript is absent from Reviewer history.
- [ ] Confirm `item/completed`, `turn/diff/updated`, and `turn/completed` shapes.
- [ ] Confirm unexpected approval requests are declined noninteractively.
- [ ] Confirm interrupted and failed turns surface as CLI failures.
- [ ] Confirm App Server process exits cleanly after success and failure.
- [ ] Run against one no-Git repository.
- [ ] Run against one clean Git repository and inspect branch/checkpoints.
- [ ] Run against one dirty Git repository and confirm no destructive Git action.
