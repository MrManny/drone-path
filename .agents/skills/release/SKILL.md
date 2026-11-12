---
name: release
description: Release workflow. Use when preparing a release.
---

# Release procedure

1. On `main`, pull the latest changes

2. Fold the changesets: run `npm run changeset:version` to derive the next version from the pending `.changeset/` fragments, fold them into `CHANGELOG.md`, remove the consumed files and sync the lock file
  - at least one changeset must be pending; if user-visible changes landed without a fragment, write the missing ones first (ask the user)

3. Confirm the target version with the user — they may want a different one for scope; if it differs from the derived version, adjust `package.json` and the new `CHANGELOG.md` heading, then re-sync the lock file (`npm install --package-lock-only`)
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

11. Once the user has published the release, watch the Release workflow: after lint and test it attaches the desktop artifacts (Windows portable exe, Linux AppImage); verify both arrived (`gh release view vX.Y.Z --json assets`) and re-run a failed leg
