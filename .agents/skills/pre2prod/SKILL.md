---
name: pre2prod
description: Run the Pre2prod reviewer-led repository hardening CLI for requested readiness phases. Use when a user wants to assess or improve a repository through Pre2prod.
---

# Pre2prod

Use the installed `pre2prod` CLI from the target repository. The CLI owns the
Reviewer/Worker workflow, prompts, Git behavior, and phase ordering.

- Run `pre2prod -l` to inspect available phases when selection is unclear.
- Forward the user's phase and execution options to `pre2prod`.
- Surface the CLI's result and errors without recreating its workflow manually.
