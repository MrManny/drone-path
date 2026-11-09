---
name: github-etiquette
description: GitHub working conventions for the drone-path repository - issue templates, gh CLI usage, branch and commit style, PR etiquette. Load when a session interacts with GitHub (filing or refining issues, creating branches, opening or updating pull requests, releases)
---

# GitHub etiquette

## Hard rules

- Issue bodies **must** follow templates where possible
- Before opening an issue, spot-check that such an issue does not already exist
- Bug issues **should** carry a root cause analysis — in the body when done before opening, in the comments when done after — grounded in evidence (e.g. OpenTelemetry traces)
- Before working on an issue: read its comments and assign it to the user
- Write issue and PR bodies to a file first, pass it via `--body-file`; never inline long bodies into shell arguments
- Issues and PRs **should** be free of bloat: one paragraph per section, or a list where one fits (e.g. Acceptance Criteria, Steps to Reproduce)
- GitHub Flavored Markdown needs blank lines between paragraphs; a single newline is not a line break
- Commit messages **must** follow Conventional Commits, e.g. `docs: GitHub issue templates`, `refactor: restructure code base along Fowler/Clean Code lines`
- PR titles **should** follow Conventional Commits style
- An agent may **never** merge a PR, only a human may
- An agent **should** wait for human approval before opening a PR

## Repository facts

- Branch naming: `<type>/<issue-number>-<slug>`, e.g. `docs/3-agent-instructions`; release branches are exempt and use `release/vX.Y.Z`
- Release commits use the `release` type, e.g. `release: v0.2.0` — custom types are valid per the Conventional Commits spec (rule 14), so keep them as-is instead of "correcting" them to `chore(...)`
- Historic: `neo2-flightpath` (npm package and command) at `https://github.com/MrManny/neo2-flightpath` was the working title before the rebrand to `drone-path`; old URLs redirect to `https://github.com/MrManny/drone-path`

## Recommendations

- Use the `gh` CLI tool if available to interact with the repository

## Deep dives

Read on demand, only the part you need:

- [issues.md](issues.md): templates, description structure, refinement workflow; read this when opening or editing issue bodies
- [pull-requests.md](pull-requests.md): draft/undraft etiquette, titles, reviews, merging; read this when opening or editing pull requests
- [commands.md](commands.md): `gh` CLI cheat sheet (issues, pull requests, CI)
