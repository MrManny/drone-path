# AGENTS.md

Development instructions; the user manual lives in [docs/user/](docs/user/README.md),
and [README.md](README.md) is the quick-start. Follow the
[manual editing rules](packages/tooling/AGENTS.md#user-manual) when changing user docs.

## Setup & commands

- Node.js 24 or 26, npm. Use `npm ci` at the root for the shared lockfile.
- Run `npm run lint`, `npm test`, and `npm run build` at the root to check the
  whole repository.
- When adding a dependency, pin it to a patch-level range (for example, `~1.2.3`).
  New dependencies must have no high or critical security issues — check
  `https://security.snyk.io/package/npm/<package_name>` before adding one.

## Workspaces

Cross-workspace imports always use package subpaths (`<package>/<module>`), never
relative paths across workspace boundaries.

| Workspace | Package | Internal deps | Owns & targeted commands |
| --- | --- | --- | --- |
| [Core](packages/core/AGENTS.md) | `drone-path-core/*` | *(none)* | Telemetry (DVTM & SRT), spatial/gaze math, shot segmentation, track & NLE exports, FFmpeg discovery |
| [Archive](packages/archive/AGENTS.md) | `drone-path-archive/*` | `core` | Recording library scanner, SQLite index, spatial/gaze/segment queries, flight grouping, map/track exports |
| [Engine](packages/engine/AGENTS.md) | `drone-path-engine/*` | `core` | Option vocabulary (`src/config.ts`), map tiles, headless browser rendering, video pipeline |
| [CLI](packages/cli/AGENTS.md) | `drone-path` | `core`, `archive`, `engine` | CLI entrypoints (`render`, `archive`, `mcp`, `extract-frame`), stdio, exit codes (`npm run build:cli`) |
| [Tooling](packages/tooling/AGENTS.md) | `drone-path-tooling` | `core`, `engine` | CLI reference, JSON schema, offline manual, and build identity generators (`npm run docs:reference`, `docs:schema`) |
| [Desktop](apps/desktop/AGENTS.md) | `drone-path-desktop` | `core`, `engine` | Electron main, Next.js UI (`ui/`), i18n catalogs, packaging (`npm run app`, `app:dev`, `app:pack`) |

## Testing

- One `test/<module>.test.ts` per source module in its workspace. Reuse fixtures
  from root `test/fixtures/` (`tmpDir()` + `afterEach(cleanupTmpDirs)`).
- Deterministic and offline, needing nothing beyond Node: no network, tile
  downloads, ffmpeg/ffprobe, or browser.
- Behavior changes ship with tests: sunny and common rainy cases; a bug fix
  gets a regression test. Use parameterized tests (`describe.for`/`describe.each`)
  for bulk cases. Never commit `.only`, `.skip`, or `.todo`.

## Conventions

- Use American English, not British English.
- TypeScript strict, ESM, NodeNext: relative imports carry `.js`, built-ins use
  `node:`, types via `import type`.
- camelCase / PascalCase / UPPER_SNAKE_CASE; one concern per file.
- Comments say *why*, not *what* — and only where they add something that is not
  self-evident; drop comments that provide no real value.
- Progress/errors → stderr; `--json` output → stdout.
- Errors: throw plain `Error` with a lowercase message; when catching and
  rethrowing, wrap the original with `{ cause }` instead of dropping it.
- Top-level failures report `[drone-path] ERROR: <message>` on stderr and
  set `process.exitCode` — never call `process.exit()` mid-flow.

## Design principles

- One job per function; long flows as compose-method stages.
- Pure core, imperative shell: parsing, geometry, planning, and config merging
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

## Agent helpers & GitHub

Temporary files and worktrees go in `.scratch` (git-ignored). Issues, branches,
commits, PRs, and releases follow
[`.agents/skills/github-etiquette/`](.agents/skills/github-etiquette/SKILL.md).

Deterministic dev helpers in `scripts/` wrap repetitive GitHub tasks (each opens
with a ≤10-line tl;dr comment and spawns external commands through
`scripts/lib/exec.mjs` with hidden windows on Windows; project status and
assignment steps are best-effort):

- `node scripts/start-work.mjs <branch>` — assign the issue, create the branch,
  and set it "In progress".
- `node scripts/safe-push.mjs` — lint, test, and build, then push the current
  branch; on failure the full error is on stderr.
- `node scripts/open-pr.mjs <title> <body_path> [base]` — safe-push, then open
  the PR (base defaults to `main`) with label and status bookkeeping.
