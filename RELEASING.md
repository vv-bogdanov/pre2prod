# Releasing

Pre2Prod is distributed as an npm CLI. A packed tarball is the local release
candidate; there is no service deployment, migration, or container image.

## Prepare a release candidate

1. Start from a clean `main` branch with CI passing.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm run release:check`.
4. Inspect `.pre2prod/pack-check/pre2prod-<version>.tgz` and its file list.
5. Complete the live checks in `docs/LIVE_COMPATIBILITY_CHECKLIST.md` against
   the exact supported Codex CLI before a public release.
6. Run `npm version <version> --no-git-tag-version` and commit the version
   change. `package.json` is the single version source for the package and CLI.

`release:check` validates source, audits production dependencies, packs without
rerunning lifecycle scripts, installs the tarball into a fresh temporary
prefix, and invokes the installed CLI.

## Publish

After the release candidate passes, an authenticated package owner can publish
the current version with:

```bash
npm publish --access public
```

Verify the registry package before tagging the same commit. A future automated
release should use npm trusted publishing; do not store a long-lived npm token
in this repository.

## Recover from a bad release

npm versions are immutable. Deprecate the affected version with a clear reason,
fix the issue on `main`, rerun the complete release gate, and publish a new
patch version. Use npm unpublish only when the registry policy permits it and
the exceptional removal is preferable to deprecation. Record the affected and
replacement versions in the release notes.
