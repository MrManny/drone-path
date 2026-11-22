---
name: release
description: Release workflow. Use when preparing a release.
---

# Release procedure

1. On `main`, pull the latest changes

2. Fold the changesets with `npm run changeset:version`. This versions core, archive, engine, CLI, and desktop together, updates their workspace changelogs, removes the consumed fragments, and syncs the lockfile. Collect the user-facing entries in the root `CHANGELOG.md`.
  - at least one changeset must be pending; if user-visible changes landed without a fragment, write the missing ones first (ask the user)

3. Confirm the target version with the user. If it differs from the derived version, update the five release workspace manifests, their internal dependency ranges and any references in other workspaces, and the new changelog headings. Sync the lockfile with `npm install --package-lock-only`.
  - if the pending fragment is `major`, say so explicitly when asking

4. Switch to a dedicated release branch `release/vX.Y.Z`

5. Rewrite the new `CHANGELOG.md` sections (root and workspaces) as prose release notes before committing
  - group changes by "Core libraries", "CLI", and "Desktop"
  - terse labeled lines: `**New:**` what users can do now that they could not before, `**Fixed:**` which known issues were fixed, `**Internal:**` (optional, last) changes with no user impact
  - omit labeled lines with no content instead of writing `Nothing this release.`
  - no commit hashes, issue numbers or fragment bookkeeping; strip changeset-generated `### Minor Changes` / `### Patch Changes` / `Updated dependencies` boilerplate and follow the voice of existing `CHANGELOG.md` sections
  - fold any unshipped pre-release sections (e.g. `1.0.0-rc1`) into the final release section across both root and workspace changelogs

6. Preview the release plan from an installed, built checkout without publishing: `node scripts/release-npm.mjs dry-run vX.Y.Z`

7. Commit with the subject `release: vX.Y.Z` and push

8. Open a PR with the title `release: vX.Y.Z`

9. Wait for GitHub CI on the PR; the pipeline **must** be green to continue — otherwise halt and ask the user for direction

10. When CI has finished, let the user do a final inspection of the PR and merge it

11. When the user has merged the PR, draft the release with `gh release create vX.Y.Z --draft --notes-file <file>`: tag and title `vX.Y.Z`, description = the new `CHANGELOG.md` section for `vX.Y.Z` (extract it to a file)

12. Once the user has published the release, watch the Release workflow. After the tag check, lint, and tests, it publishes `drone-path-core`, `drone-path-archive`, `drone-path-engine`, and `drone-path` to npm in dependency order. Separate jobs attach the Windows installer and portable exe, Linux AppImage, and auto-update feed. GitHub prereleases publish to npm under the `next` dist-tag instead of `latest`. Verify the npm versions and GitHub assets (`gh release view vX.Y.Z --json assets`).

Final checks before considering the release successful: packages are published on the NPM registry.

## Trusted publishing & recovery

Reserve the release's exact package versions for GitHub Actions. To bootstrap a new public package name on npm:

1. Either set the repository's `NPM_TOKEN` secret to a granular token authorized to create the new public package names and publish all packages in the release (the workflow uses `--provenance` with the token), or manually publish a distinct, earlier prerelease for each new name under a non-default dist-tag (`npm publish --workspace <name> --access public --tag bootstrap`) so the release's exact versions remain unused.
2. Once each package exists on npm, configure its [trusted publisher](https://docs.npmjs.com/trusted-publishers/) with owner `MrManny`, repository `drone-path`, workflow `release.yml`, and permission for direct publishing.
3. Remove `NPM_TOKEN` when all four packages (`drone-path-core`, `drone-path-archive`, `drone-path-engine`, `drone-path`) are configured so subsequent releases use token-free OIDC trusted publishing.

After a partial publish failure, check the package versions on npm and re-run only the failed jobs in GitHub Actions. Each package has its own job, so completed package jobs keep their successful result and dependent jobs resume in order.
