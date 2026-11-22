# Changesets

Every user-visible change ships with a small Markdown fragment in this
directory. Changesets folds fragments into the affected workspace changelogs.
The release PR also summarizes user-facing changes in the root `CHANGELOG.md`.

## Adding a changeset

Add a `<issue-number>-<slug>.md` file:

```md
---
"drone-path": minor
"drone-path-desktop": minor
---

Describe the change as a user would notice it in one or two sentences.
```

List the affected release workspaces:

- `drone-path-core` — telemetry extraction, spatial math, track and NLE exports
- `drone-path-archive` — recording library indexing, queries, and archive exports
- `drone-path-engine` — configuration, map tiles, and the render pipeline
- `drone-path` — the CLI (`render`, `archive`, `mcp`, `extract-frame`)
- `drone-path-desktop` — the Electron desktop app

A single fragment can name several workspaces with their own bump levels.
These five workspaces version in lockstep at the highest requested bump.
Changesets updates internal npm dependency ranges, and the release procedure
syncs the root lockfile. The desktop app stays private and ships through
GitHub Releases.

The bump level in the front matter (`major`, `minor`, `patch`) says how the
change affects the version:

- `major` — breaking changes
- `minor` — new features and other backward-compatible behavior changes
- `patch` — bug fixes

Pull requests titled `feat:`/`fix:` must add a fragment, and pull requests
titled `release:` must change `CHANGELOG.md`; CI enforces both. Pull requests
titled `chore:`, `docs:`, `refactor:`, `test:` or `ci:` need no fragment.
