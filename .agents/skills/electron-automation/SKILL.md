---
name: electron-automation
description: Launch, drive and instrument the Drone Path Electron app from an agent session (UI automation, screenshots, request/timing evidence). Load when verifying UI work against the desktop app or capturing evidence from it.
---

# Automating the Electron App

How an agent session can launch and operate the Electron desktop app
programmatically. Re-check `package.json` and `app/main.mjs` before relying
on exact flags.

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
  (`dronepath:pick`, `-:session`, `-:settings`) bridged through
  `app/preload.cjs` as `window.dronepath`.
- **Tool check at startup:** ffmpeg/ffprobe resolve via `src/fftools.ts`
  (`requireTools()`: config override, embedded binaries, then PATH); without a
  runnable pair the app dies at startup behind a native error box. Check first
  (`where.exe ffmpeg` / `where.exe ffprobe` or the bundled pair).

## Recommended: Playwright's Electron launcher

`playwright-core` (a runtime dependency for headless rendering in
`src/render.ts`) exports the `_electron` launcher — **zero new dependencies**:

```js
import { _electron } from 'playwright-core';

const app = await _electron.launch({
  executablePath: 'node_modules/electron/dist/electron.exe', // explicit is safest on Windows
  args: ['app/main.mjs'], // add '--dev-url', 'http://localhost:3210' for dev mode
  cwd: 'E:/DJI_001/scripts/neo2-flightpath', // repo root
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
await page.screenshot({ path: 'shot.png' });
await page.locator('...').click();
page.on('console', (m) => console.log('renderer:', m.text()));
const session = await page.evaluate(() => window.dronepath.getSession());
await app.close(); // window-all-closed quits the app
```

`app.evaluate()` also reaches the main process — e.g.
`BrowserWindow.getAllWindows()[0].webContents.capturePage()` for a
window-level screenshot.

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

Re-arm the stub mid-run: have it read a driver-swapped global (e.g.
`globalThis.__pickVideo`) at call time, so one session can open several
recordings in sequence.

## Fallback: raw CDP

If the app is already running (or the Playwright driver misbehaves), launch
with `electron app/main.mjs --remote-debugging-port=9223` and attach with
`chromium.connectOverCDP('http://127.0.0.1:9223')` from `playwright-core`.
Same page driving, less convenient for main-process access. The IPC trust
check accepts both `app://bundle/...` frames and the dev URL, so the preload
bridge works in either mode.

## Instrumenting request traffic and timing

For timing evidence (e.g. tile request-rate checks), wrap `globalThis.fetch`
in the main process via `app.evaluate`: record `Date.now()` and URL per
request under study and resolve a tiny local response (a base64 PNG suffices
for tiles) instead of touching the network. The request gate sits in front of
`fetch`, so recorded call times *are* request-start times; pass every other
URL through to the real fetch. Push phase markers into the same timeline and
write raw JSON for offline analysis.

Timing assertions need the right clock model: fake timers cannot produce late
wakes (`vi.setSystemTime` shifts pending timer deadlines with it, and nothing
models thread starvation). To reproduce production jitter (a busy event loop
delaying a scheduled wake), drive on real timers and stall with a spun
busy-wait (`while (Date.now() < until) {}`) inside the intercepted request,
then assert *lower bounds* — every start at least the gate interval after the
previous one plus its wake lateness — not exact values. Slot- or release-based
gates show millisecond-level jitter (single pairs can dip 1–2 ms below the
nominal interval), so judge rate budgets by sustained rate and absence of
cross-lane interleave. Plan-sized at 2 requests/s, runs take tens of seconds
per lane: give generous timeouts and measure the timeline over wall-clock
guesses.

## Operational notes

- **Logs:** progress and errors go to stderr as `[drone-path] <msg>` /
  `[drone-path] ERROR: <message>`; parse these for `loaded:` confirmations.
  `ELECTRON_ENABLE_LOGGING=1` adds Chromium-level logs; capture lines via
  `app.process().stderr.on('data', ...)`.
- **Quit/kill:** closing the window quits (`window-all-closed ->
  app.quit()`). When launched via `npm run app`, kill the process tree
  (`taskkill /PID <pid> /T /F` or `Stop-Process -Name electron`); a killed
  `npm`/`pwsh` wrapper can orphan `electron.exe`.
- **Dev vs. prod:** iterate in dev (`--dev-url`, hot reload); verify in
  production (`ui/out`) — deterministic and what users run.
- **Missing electron binary:** `node_modules/electron` can exist without
  `dist/electron.exe` (some environments skip the postinstall download). Run
  `node install.js` inside the package to fetch it; the cache in
  `%LOCALAPPDATA%\electron\Cache` makes repeats fast, and one extracted
  runtime drives any checkout or worktree via `executablePath` + `cwd`.
- **`app.evaluate` argument position:** the callback gets the electron module
  first and the caller's argument second — `app.evaluate(({ dialog }, arg) => ...)`.
  A single-parameter callback silently receives the electron module
  (circular), surfacing as `Received an instance of Object` or "Converting
  circular structure to JSON". `page.evaluate(fn, arg)` is the normal
  Playwright convention.

## Notes for automated sessions under the DSH harness

- Spawning Electron with piped stdio from a Node driver hits the
  EPERM-on-piped-stdio restriction in confined sandbox modes; run the driver
  under at least workspace-write (FullLanguage on Windows) or as a background
  job.
- **`ELECTRON_RUN_AS_NODE` trap:** harness shells and some IDE terminals
  export `ELECTRON_RUN_AS_NODE=1`; spawned `electron.exe` then behaves like
  plain Node (`SyntaxError: ... does not provide an export named
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
- Expect a **visible window** on the desktop (Electron has no true headless
  mode on Windows); CDP/Playwright traffic is plain TCP loopback, unaffected
  by the named-pipe restriction.
- No e2e harness exists in `test/` (unit tests are vitest-only and offline per
  `AGENTS.md`); a Playwright driver is a separate, non-unit concern.
