# Pull requests

An agent **should** wait for human approval before opening a PR.

## Titles

Short and imperative in a Conventional Commits style, e.g. `docs(agents): Agent instructions`.

Release PRs are titled `release: vX.Y.Z`; since PRs squash-merge, that title becomes the release commit subject on `main`.

## Body

Keep the body current when fix-ups make it stale.
Use `Closes #n` or `Fixes #n` to close an underlying issue; `Refs #n` leaves it open when only partially solved.

## Labels

When opening a PR, apply the same labels as the issue.

## Drafts

Open work-in-progress PRs as **drafts** (`gh pr create --draft`).
Keep the draft body light; write the full description when undrafting, once the work is complete.

## Merging

The default and recommended merge strategy is squash-merge. Agents never merge PRs themselves (see hard rules).
