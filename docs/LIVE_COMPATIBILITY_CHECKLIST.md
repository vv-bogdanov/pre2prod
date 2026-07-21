# Live Codex compatibility checklist

The automated suite validates orchestration against a protocol-faithful mock
process. Live dogfood runs on Linux have also completed the Reviewer/Worker
vertical flow against an authenticated Codex installation.

- [x] Record `codex --version` (confirmed locally: `codex-cli 0.144.6`).
- [x] Generate the installed CLI's TypeScript bindings and compare the used
      subset. The adapter sends the required initialization, input, sandbox,
      network, workspace, and approval fields.
- [x] Run `pnpm run validate`: formatting, typechecking, linting, build, 101
      tests, and coverage thresholds passed.
- [x] Confirm `codex app-server` starts over stdio and completes the
      `initialize` / `initialized` handshake.
- [x] Confirm `thread/start` creates the persistent Reviewer thread.
- [x] Confirm Reviewer turns run read-only and return structured output through
      `outputSchema`.
- [x] Confirm `thread/fork` creates a Worker from the exact completed review
      turn.
- [x] Confirm the Worker goal lifecycle through `thread/goal/set`,
      `thread/goal/get`, `thread/goal/updated`, and `thread/goal/clear`.
- [x] Confirm the planning turn is read-only, returns a non-empty plan, and the
      CLI writes it to `PRE2PROD_PLAN.md` before execution.
- [x] Confirm the execution turn receives workspace-write access and the
      configured network policy.
- [x] Confirm the original Reviewer continues after Worker completion and
      independently re-reviews the changed repository.
- [x] Confirm the Worker transcript is not merged into Reviewer history.
- [x] Confirm live command, item, diff, usage, goal, and turn notifications are
      accepted by the runtime.
- [x] Confirm successful runs close the App Server process and create phase
      checkpoints in a clean Git repository.
- [ ] Exercise unexpected live approval requests and confirm they are declined
      noninteractively. Automated protocol tests cover this path.
- [ ] Exercise interrupted and failed live turns and confirm the App Server
      exits cleanly. Automated runtime tests cover these paths.
- [ ] Repeat the no-Git and dirty-worktree safety checks against a live Codex
      process. Automated Git tests cover both cases without starting a turn.
