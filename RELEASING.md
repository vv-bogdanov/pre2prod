# Releasing

Pre2prod is distributed as an npm CLI. A packed tarball is the local release
candidate; there is no service deployment, migration, or container image.

## Prepare a release candidate

1. Start from a clean `main` branch with CI passing.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm run release:check`.
4. Inspect `.pre2prod/pack-check/pre2prod-<version>.tgz` and its file list.
5. Complete the live checks in `docs/LIVE_COMPATIBILITY_CHECKLIST.md` against
   the exact supported Codex CLI before a public release.
6. Update the version with the repository's normal SemVer review and commit the
   version change.

`release:check` validates source, audits production dependencies, packs without
rerunning lifecycle scripts, installs the tarball into a fresh temporary
prefix, and invokes the installed CLI.

## Publish

Public publication is intentionally blocked until the repository owner has
configured npm package ownership and GitHub-to-npm trusted publishing. Add and
review a dedicated OIDC release workflow before the first publication; do not
store a long-lived npm token in this repository.

## Recover from a bad release

npm versions are immutable. Deprecate the affected version with a clear reason,
fix the issue on `main`, rerun the complete release gate, and publish a new
patch version. Use npm unpublish only when the registry policy permits it and
the exceptional removal is preferable to deprecation. Record the affected and
replacement versions in the release notes.
