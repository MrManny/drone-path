---
"neo2-flightpath": minor
---

Renders and exports no longer need a local ffmpeg install: static ffmpeg and ffprobe binaries ship with the desktop app and the npm package (`--ffmpeg <path>` / `--ffprobe <path>` override them, PATH remains a fallback; a first `npx` run downloads them into the npx cache). This also smooths agentic environments, where agents driving the CLI or the app often meet machines with no ffmpeg installed or on PATH.
