---
name: release
description: Release workflow. Use when preparing a release.
---

# Release procedure

1. On `main`, pull the latest changes

2. Fold the changesets with `npm run changeset:version`. This versions core, archive, engine, CLI, and desktop together, updates their workspace changelogs, removes the consumed fragments, and syncs the lockfile. Collect the user-facing entries in the root `CHANGELOG.md`.
  - at least one changeset must be pending; if user-visible changes landed without a fragment, write the missing ones first (ask the user)

3. Confirm the target version with the user. If it differs from the derived version, update the five release workspace manifests, their internal dependency ranges and any references in other workspaces, and the new changelog headings. Sync the lockfile with `npm install --package-lock-only`.
  - if the pending fragment is `major`, say so explicitly when asking: while the version is `0.x` it means a `1.0.0` release (see `.changeset/README.md`)

4. Switch to a dedicated release branch `release/vX.Y.Z`

5. Rewrite the new `CHANGELOG.md` section as prose release notes before committing
  - terse labeled lines: `**New:**` what users can do now that they could not before, `**Fixed:**` which known issues were fixed, `**Internal:**` (optional, last) changes with no user impact
  - omit labeled lines with no content instead of writing `Nothing this release.`
  - no commit hashes, issue numbers or fragment bookkeeping; follow the voice of existing `CHANGELOG.md` sections

6. Commit with the subject `release: vX.Y.Z` and push

7. Open a PR with the title `release: vX.Y.Z`

8. Wait for GitHub CI on the PR; the pipeline **must** be green to continue — otherwise halt and ask the user for direction

9. When CI has finished, let the user do a final inspection of the PR and merge it

10. When the user has merged the PR, draft the release with `gh release create vX.Y.Z --draft --notes-file <file>`: tag and title `vX.Y.Z`, description = the new `CHANGELOG.md` section for `vX.Y.Z` (extract it to a file)

11. Once the user has published the release, watch the Release workflow. After the tag check, lint, and tests, it publishes core, archive, engine, and CLI to npm in dependency order. Separate jobs attach the Windows installer and portable exe, Linux AppImage, and auto-update feed. Verify the npm versions and GitHub assets (`gh release view vX.Y.Z --json assets`). If a job fails, use the failed-jobs retry so successful publish jobs keep their result. See [Releasing](../../../README.md#releasing) for trusted-publisher bootstrap.
