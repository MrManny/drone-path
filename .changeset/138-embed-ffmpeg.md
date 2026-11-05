---
"neo2-flightpath": minor
---

Renders and exports no longer need a local ffmpeg install: static ffmpeg and ffprobe 7.1.0 binaries ship with the desktop app and the npm package (`--ffmpeg <path>` / `--ffprobe <path>` override them, PATH remains a fallback; installing downloads them in a postinstall step, ~250 MB for both tools). This also smooths agentic environments, where agents driving the CLI or the app often meet machines with no ffmpeg installed or on PATH.
