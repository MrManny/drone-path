# Worktree work

Working on a neo2-flightpath branch in a dedicated `git worktree` instead of the main checkout.

## When to use

Load when creating, operating in, or cleaning up a dedicated worktree.

## tl;dr

- `node scripts/start-work.mjs <branch>` checks the branch out in the *main* checkout; run
  `git checkout main` there first, then `git worktree add ../neo2-flightpath-<issue> <branch>`.
- A fresh worktree has no `node_modules` and no git-ignored files: run `npm ci` in it, and
  copy whatever you need from `.scratch/` (ignored, so it never travels with the branch).
- Read a file before editing it *at the worktree path*: reading the main checkout's copy
  does not unlock edits to the worktree copy.
- If `node_modules/electron/dist/electron.exe` is missing after `npm ci`, run
  `node node_modules/electron/install.js`; the postinstall can leave no `dist/`.
- Run lint/test/build and point subagents (`cwd`) at the worktree, never the main checkout.
- After the PR is merged: `git worktree remove <path>` and delete the branch. Never merge
  the PR yourself.
