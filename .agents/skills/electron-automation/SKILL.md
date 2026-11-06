---
name: electron-automation
description: Launch, drive and instrument the neo2-flightpath Electron app from an agent session (UI automation, screenshots, request/timing evidence). Load when verifying UI work against the desktop app or capturing evidence from it.
---

# Automating the Electron App

How an agent session can launch and operate the Electron desktop app
programmatically, e.g. to verify UI work or take screenshots. Re-check
`package.json` and `app/main.mjs` before relying on exact flags.

## How the app launches

- **Production:** `npm run build` (compiles `src/` to `dist/`, builds the
  Next.js static export to `ui/out/`), then `npm run app` (`electron
  app/main.mjs`). `npm ci` runs `build` via `prepare`, so a fresh checkout is
  launchable as-is.
- **Dev:** `npm run app:dev` starts `next dev ui --webpack -p 3210` and
  launches Electron with `--dev-url http://localhost:3210` once the server
  responds. `--webpack` is mandatory: Turbopack cannot resolve the renderer's
  NodeNext `.js` specifiers.
- The shell (`app/main.mjs`) is thin: one window, a privileged `app://bundle`
  scheme serving `ui/out` plus media and tiles, and three IPC handlers
  (`neo2flightpath:pick`, `-:session`, `-:settings`) bridged through
  `app/preload.cjs` as `window.neo2flightpath`. Session logic lives in the
  Electron-free state machine `src/appsession.ts` (`pick -> validate ->
  prepare`).
- Startup tool check: ffmpeg/ffprobe resolve via `src/fftools.ts` (config
  override, embedded binaries, then PATH); `requireTools()` kills startup with
  a native error box when neither runs.

## Recommended: Playwright's Electron launcher

`playwright-core` is already a runtime dependency (headless rendering in
`src/render.ts`) and exports the `_electron` launcher — **zero new
dependencies**:

```js
import { _electron } from 'playwright-core';

const app = await _electron.launch({
  executablePath: 'node_modules/electron/dist/electron.exe', // explicit is safest on Windows
  args: ['app/main.mjs'], // add '--dev-url', 'http://localhost:3210' for dev mode
  cwd: 'E:/DJI_001/scripts/neo2-flightpath',
  // Harness shells may export ELECTRON_RUN_AS_NODE; see the notes below.
  env: Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'),
  ),
});

// Stub the native file dialog BEFORE the UI picks a file (see below).
await app.evaluate(({ dialog }) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['D:/sample.mp4'] });
});

const page = await app.firstWindow();
await page.waitForLoadState('networkidle');
await page.screenshot({ path: 'shot.png' }); // visual verification
await page.locator('...').click(); // operate the UI like a normal page
page.on('console', (m) => console.log('renderer:', m.text()));
const session = await page.evaluate(() => window.neo2flightpath.getSession());
await app.close(); // window-all-closed quits the app
```

This covers implementation sessions: launch, click and type, read app state
via the preload bridge (`getSession()`), capture screenshots, collect renderer
console output. `app.evaluate()` also reaches the main process (e.g.
`BrowserWindow.getAllWindows()[0].webContents.capturePage()` for a
window-level screenshot).

## The one real obstacle: the native file dialog

`pickRecording()` opens a native `dialog.showOpenDialog` (`app/main.mjs`),
which Playwright cannot automate (`page.on('dialog')` handles only JS
dialogs). Two solutions:

1. **Monkey-patch, no code change:** patch `dialog.showOpenDialog` via
   `app.evaluate` to return a fixed path (as above). Works because
   `app/main.mjs` resolves the method at call time on the shared `dialog`
   object.
2. **Cleaner long-term (small future change):** a flag such as `--open <path>`
   (or an env var) so `pickFile` skips the dialog when a path is supplied —
   ideal for CI-style smoke tests.

The stub can be re-armed mid-run: have it read a driver-swapped global (e.g.
`globalThis.__pickVideo`) at call time, so one session can open several
recordings in sequence.

## Fallback: raw CDP

If the app is already running (or the Playwright driver misbehaves), launch
with `electron app/main.mjs --remote-debugging-port=9223` and attach with
`chromium.connectOverCDP('http://127.0.0.1:9223')` from `playwright-core`.
Same page-driving capabilities, slightly less convenient for main-process
access. The IPC trust check accepts both `app://bundle/...` frames and the dev
URL, so the preload bridge works in either mode.

## Instrumenting request traffic and timing

For timing evidence (e.g. tile request-rate checks), wrap `globalThis.fetch`
in the main process via `app.evaluate`: record `Date.now()` and the URL for
the requests under study and resolve a tiny local response (a base64 PNG
suffices for tile images) instead of touching the network. The app's request
gate sits in front of `fetch`, so recorded call times *are* request-start
times; pass every other URL through to the real fetch. Push phase markers into
the same timeline and write raw JSON out for offline analysis.

Timing assertions need the right clock model. Fake timers cannot produce late
wakes: `vi.setSystemTime` shifts pending timer deadlines with it, and nothing
models thread starvation. To reproduce production jitter (a busy event loop
delaying a scheduled wake), drive on real timers and stall with a spun
busy-wait (`while (Date.now() < until) {}`) inside the intercepted request,
then assert *lower bounds* — every start at least the gate interval after the
previous one plus its wake lateness — not exact values. Slot- or
release-based gates otherwise show millisecond-level jitter (single pairs can
dip 1–2 ms below the nominal interval), so judge rate budgets by sustained
rate and absence of cross-lane interleave. Plan-sized at 2 requests/s, runs
take tens of seconds per lane: give generous timeouts and measure the
timeline over wall-clock guesses.

## Operational notes

- **Logs:** progress and errors go to stderr as `[neo2-flightpath] <msg>` /
  `[neo2-flightpath] ERROR: <message>`; parse these for `loaded:`
  confirmations. `ELECTRON_ENABLE_LOGGING=1` adds Chromium-level logs.
  `app.process().stderr.on('data', ...)` captures the lines for assertions.
- **Quit/kill:** closing the window quits (`window-all-closed ->
  app.quit()`). When launched via `npm run app`, kill the process tree
  (`taskkill /PID <pid> /T /F` or `Stop-Process -Name electron`); a killed
  `npm`/`pwsh` wrapper can orphan `electron.exe`.
- **Dev vs. prod:** dev mode (`--dev-url`) for iteration (hot reload);
  production (`ui/out`) is deterministic and is what users run.
- **Missing electron binary:** `node_modules/electron` can exist without
  `dist/electron.exe` (postinstall download some environments skip). Run
  `node install.js` inside the package to fetch it; the cache in
  `%LOCALAPPDATA%\electron\Cache` makes repeats fast, and one extracted
  runtime drives any checkout or worktree via `executablePath` + `cwd`.
- **`app.evaluate` argument position:** the callback gets the electron module
  as its *first* parameter and the caller's argument second —
  `app.evaluate(({ dialog }, arg) => ...)`. A single-parameter callback
  silently receives the electron module (circular), surfacing later as
  `Received an instance of Object` or "Converting circular structure to
  JSON". `page.evaluate(fn, arg)` is the normal Playwright convention.
- **Prerequisite check before launch:** bundled ffmpeg/ffprobe (or
  `where.exe ffmpeg`/`where.exe ffprobe`); without a runnable pair the app
  dies at startup behind a native error box.

## Notes for automated sessions under the DSH harness

- Spawning Electron with piped stdio from a Node driver can hit the
  EPERM-on-piped-stdio restriction in confined sandbox modes. Run the driver
  under at least workspace-write (FullLanguage on Windows) or as a background
  job.
- **`ELECTRON_RUN_AS_NODE` trap:** harness shells and some IDE terminals
  export `ELECTRON_RUN_AS_NODE=1`; every spawned `electron.exe` then behaves
  like plain Node (`SyntaxError: ... does not provide an export named
  'BrowserWindow'`, or `_electron.launch` reporting `Process failed to
  launch!`). Clear it in the driving shell *and* pass an `env` without it to
  `_electron.launch`.
- **Driver script location:** keep the driver inside the repo (the gitignored
  `out/` is a good spot) so `import 'playwright-core'` resolves via the
  repo's `node_modules`; OS temp fails with `ERR_MODULE_NOT_FOUND`.
- **PowerShell exit codes:** piping a driver through `2>&1` in a background
  job can make a successful run report `[exit code: 1]`; trust the driver's
  own output and exit status.
- **Long inline scripts:** a multi-line `node -e` through PowerShell can come
  out mangled and fail silently; write to a scratch file and run that.
- Expect a **visible window** on the desktop: Electron has no true headless
  mode on Windows, convenient for supervision. CDP/Playwright traffic is
  plain TCP loopback, unaffected by the named-pipe restriction.
- There is no e2e harness in `test/` (unit tests are vitest-only and offline
  per `AGENTS.md`); a Playwright driver is a separate, non-unit concern.

## Bottom line

Launching is `npm run app` (or `_electron.launch`), operating is normal
Playwright page automation plus the `window.neo2flightpath` bridge, and the
only friction point — the native file picker — is solvable today with a
`dialog.showOpenDialog` stub via `app.evaluate`, and cleanly later with a tiny
`--open <path>` flag.
