---
"drone-path-desktop": patch
"drone-path-engine": patch
---

Validate desktop export and track save destinations against main-held dialog selections, restrict `--dev-url` to loopback origins in unpackaged dev runs, block untrusted `BrowserWindow` navigation and redirects, and disable upward `.dronepath.json` discovery from `process.cwd()` in the desktop shell.
