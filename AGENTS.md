# AGENTS.md

Development instructions; the user manual lives in [docs/user/](docs/user/README.md),
[README.md](README.md) is the quick-start.

## Setup & commands

- Node.js 24 or 26, npm. Use `npm ci` to install dependencies.
- `npm run build` compiles the CLI (`dist/`), compiles the user manual into
  the UI (`npm run build:manual`), injects the build identity shown by
  Help → About (`npm run build:info`), and builds the UI export (`ui/out/`);
  `npm run app` starts the Electron desktop app against it (packaging uses
  `electron-builder`). `npm run docs:reference` regenerates the checked-in
  `docs/user/cli-reference.md` from the option vocabulary in `src/config.ts`.
- `npm run app:pack` packages the desktop app with `electron-builder`.
- When adding a new dependency, pin it to a patch-level range (i.e. `~1.2.3`);
  new dependencies **must not** have high or critical security issues on
  Snyk. Check `https://security.snyk.io/package/npm/<package_name>`.

## Testing

- One `test/<module>.test.ts` per source module; fixtures in `test/fixtures.ts`
  (`tmpDir()` + `afterEach(cleanupTmpDirs)`).
- Deterministic and offline, needing nothing beyond Node: no network, tile
  downloads, ffmpeg/ffprobe or browser.
- Behavior changes ship with tests: sunny and common rainy cases; a bug fix
  gets a regression test. Use parameterized tests (`describe.for`/
  `describe.each`) for bulk cases. Never commit `.only`, `.skip` or `.todo`.

## User manual

`docs/user/*.md` is the user manual: plain GitHub Flavored Markdown, rendered
on GitHub and compiled into the app's offline help by `src/manual/`. Internal
links are relative `.md` links with GitHub heading anchors; images live in
`docs/images/` and are referenced as `../images/<file>`. `docs/user/README.md`
is the navigation index and every page must be listed there.
`docs/user/cli-reference.md` is generated (`npm run docs:reference`, never
hand-edited), and `docs/user/keyboard-shortcuts.md` must cover the key
vocabulary of `ui/lib/hotkeys.ts`; `test/userdocs.test.ts` gates all of this.

## Conventions

- Use American English, not British English.
- TypeScript strict, ESM, NodeNext: relative imports carry `.js`, built-ins use
  `node:`, types via `import type`.
- camelCase / PascalCase / UPPER_SNAKE_CASE; one concern per file.
- comments comments say *why*, not *what* — and only where they add something
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
- `src/config.ts` owns the option vocabulary; one home per concern.
- Outputs must be deterministic and idempotent.

## UI design

Before changing anything under `ui/`, read
[docs/design-guidelines.md](docs/design-guidelines.md), the source of truth for
UI tokens and design principles.

## Definition of done

- `npm run lint`, `npm test`, `npm run build` green (CI gates on lint + test
  over Node 24 + 26, then adds `npm pack --dry-run` and a desktop packaging
  smoke on Node 24).
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
