# AGENTS.md

## Mission

Build and maintain the smallest reliable MVP of the Pre2prod reviewer-led repository hardening CLI.

Required vertical flow:

```text
persistent Reviewer
→ phase review
→ fork Worker
→ Worker writes PRE2PROD_PLAN.md
→ same Worker executes it
→ Reviewer re-reviews
→ next phase
```

## Rules

1. KISS and YAGNI are mandatory.
2. Preserve the explicit Reviewer/Worker session semantics.
3. TypeScript CLI is the single source of workflow truth.
4. Use Codex App Server over stdio; do not add a second agent runtime.
5. Keep the CLI noninteractive.
6. No database, workflow framework, MCP, web UI, or DI container.
7. No language/framework/deployment adapter matrix in the MVP.
8. Reviewer reads; Worker writes.
9. Worker must return a complete plan before implementation; the CLI writes it
   to `PRE2PROD_PLAN.md`.
10. Worker transcript must not be merged into Reviewer context.
11. Never claim success without real tool results.
12. Never perform destructive production operations.
13. Prefer plain functions and explicit control flow.
14. Add abstractions only when current code has two concrete usages.
15. Code comments must be in English.
16. Keep tests focused on orchestration, protocol handling, prompts, and Git safety.
17. Verify the App Server subset against the installed Codex version before release.
18. A narrow working demo is better than an incomplete platform.
