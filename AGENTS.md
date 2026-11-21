# AGENTS.md

Development instructions; the user manual lives in [docs/user/](docs/user/README.md),
[README.md](README.md) is the quick-start. Follow the
[manual editing rules](packages/tooling/AGENTS.md#user-manual) when changing user docs.

## Setup & commands

- Node.js 24 or 26, npm. Use `npm ci` at the root for the shared lockfile.
- Run `npm run lint`, `npm test`, and `npm run build` at the root to
  check the whole repository.

When adding a dependency, pin it to a patch-level range (for example,
`~1.2.3`) and check `https://security.snyk.io/package/npm/<package_name>`
for high or critical security issues before adding it.

## Workspaces

- [Core](packages/core/AGENTS.md) owns telemetry extraction and tool discovery.
- [Engine](packages/engine/AGENTS.md) owns rendering and configuration.
- [CLI](packages/cli/AGENTS.md) owns the command and its public API.
- [Tooling](packages/tooling/AGENTS.md) owns the manual and build generators.
- [Desktop](apps/desktop/AGENTS.md) owns the Electron app, UI, and packaging.

## Testing

- One `test/<module>.test.ts` per source module in its workspace. Reuse fixtures from root `test/fixtures/`
  (`tmpDir()` + `afterEach(cleanupTmpDirs)`).
- Deterministic and offline, needing nothing beyond Node: no network, tile
  downloads, ffmpeg/ffprobe or browser.
- Behavior changes ship with tests: sunny and common rainy cases; a bug fix
  gets a regression test. Use parameterized tests (`describe.for`/
  `describe.each`) for bulk cases. Never commit `.only`, `.skip` or `.todo`.

## Conventions

- Use American English, not British English.
- TypeScript strict, ESM, NodeNext: relative imports carry `.js`, built-ins use
  `node:`, types via `import type`.
- camelCase / PascalCase / UPPER_SNAKE_CASE; one concern per file.
- comments say *why*, not *what* — and only where they add something
  that is not self-evident; drop comments that provide no real value.
- Progress/errors → stderr; `--json` output → stdout.
- Errors: throw plain `Error` with a lowercase message; when catching and
  rethrowing, wrap the original with `{ cause }` instead of dropping it.
- Top-level failures report `[drone-path] ERROR: <message>` on stderr and
  set `process.exitCode` — never call `process.exit()` mid-flow.

## Design principles

- One job per function; long flows as compose-method stages.
- Pure core, imperative shell: parsing, geometry, planning and config merging
  are pure; I/O lives in dedicated modules.
- Keep one home per concern.
- Outputs must be deterministic and idempotent.

## Definition of done

- `npm run lint`, `npm test`, `npm run build` green (CI gates on lint + test
  over Node 24 + 26, then adds dry-run packs for the published workspaces and
  a desktop packaging smoke on Node 24).
- Docs updated (README: user-visible, here: commands and standards).
- Release bookkeeping for `feat`/`fix` commits is defined in
  [`.changeset/README.md`](.changeset/README.md).

## Agent helper

### Scripts

Deterministic dev helpers in `scripts/` for repetitive GitHub tasks.
Every script opens with a tl;dr comment of at most 10 lines on how/when to use
it, so an agent can read just the first 10 lines.

- `node scripts/start-work.mjs <branch>` — assign the issue, create the
  branch, set it "In progress".
- `node scripts/safe-push.mjs` — lint, test and build, then push the current
  branch; on failure the full error is on stderr.
- `node scripts/open-pr.mjs <title> <body_path> [base]` — safe-push, then open
  the PR (base defaults to `main`) with label and status bookkeeping.

Project status and assignment steps are best-effort. Every helper spawns
external commands through `scripts/lib/exec.mjs` (one child-process policy:
hidden windows on Windows).

### Paths

Temporary files and worktrees go in `.scratch` (git-ignored).

## GitHub interactions

Issues, branches, commits, PRs and releases follow
[`.agents/skills/github-etiquette/`](.agents/skills/github-etiquette/SKILL.md).
