# Live Codex compatibility checklist

The automated suite validates orchestration against a protocol-faithful mock process. These checks require a real authenticated Codex installation.

- [x] Record `codex --version` (confirmed locally: `codex-cli 0.144.6`).
- [x] Generate the installed CLI's TypeScript bindings and compare the used
      subset. `initialize` requires `capabilities`; read-only and workspace-write
      turn sandbox policies require explicit network and workspace exclusion
      fields, text input requires `text_elements`, and the current server
      includes modern approval request methods. The adapter sends the required
      fields, declines those approval forms without granting permissions, and
      includes the required `_meta: null` in elicitation declines.
- [ ] Run the live checks below on a host where Codex can create Linux user
      namespaces for Bubblewrap and with authenticated Codex access. A
      2026-07-22 disposable CLI run using an empty `CODEX_HOME` reached
      `initialize`, `thread/start`, and the first read-only Reviewer turn, but
      the host reported the Bubblewrap user-namespace error and the turn then
      retried until Codex returned 401 Unauthorized. No credentials were used.
- [x] Run `pnpm run validate` in the writable workspace with temporary test
      files confined to `.pre2prod/test-tmp-run`: formatting, typechecking,
      linting, build, 92 tests, and coverage thresholds passed.
- [x] Confirm `codex app-server` starts over stdio: the disposable CLI run
      emitted App Server warnings and JSON-RPC telemetry before the blocked
      Reviewer turn.
- [x] Confirm `initialize` and `initialized` handshake: the run logged
      `runtime.initialize.complete`.
- [x] Confirm `thread/start` accepts `cwd`, `approvalPolicy`, `sandbox`, and
      `serviceName`: the run logged a returned Reviewer thread ID.
- [ ] Confirm Reviewer turns run under read-only sandbox.
- [ ] Confirm `outputSchema` produces parseable Reviewer JSON.
- [ ] Confirm `thread/fork` accepts `lastTurnId` for a non-ephemeral Worker.
- [ ] Confirm `thread/goal/set` endpoint shape.
- [ ] Confirm `thread/goal/get` endpoint shape.
- [ ] Confirm `thread/goal/clear` endpoint shape.
- [ ] Confirm `thread/goal/updated` notification shape.
- [ ] Confirm `thread/goal/cleared` notification shape.
- [ ] Confirm the planning turn is read-only, returns a non-empty plan, and the
      CLI writes that response to `PRE2PROD_PLAN.md` before execution.
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
