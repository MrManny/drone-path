---
"drone-path": patch
---

"Export video…" in the desktop app now renders frames with the app's embedded Chromium instead of a system browser via playwright-core. Exports work in installed builds again (they failed at the render stage with a module error) and no Chrome or Edge installation is needed.
