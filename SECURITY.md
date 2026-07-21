# Security Policy

## Supported version

Pre2Prod security fixes are made on the current `main` branch and included in
the next published version; older versions are not maintained.

## Reporting a vulnerability

Use GitHub's private vulnerability-reporting channel for this repository. If
it is unavailable, contact the repository owner privately before opening an
issue. Do not publish credentials, private source, exploit details, or other
sensitive data in an issue or discussion.

Include the affected version or commit, impact, reproduction steps, and any
suggested mitigation. Maintainers will acknowledge the report, validate its
scope, and coordinate a fix and disclosure without claiming a response SLA.

## Scope

Reports about command execution, filesystem boundaries, Git safety, credential
exposure, Codex App Server protocol handling, and dependency vulnerabilities
are in scope. Provider account policy, model behavior outside Pre2Prod's
controls, and production deployment of repositories modified by the tool are
outside this project's direct control.
