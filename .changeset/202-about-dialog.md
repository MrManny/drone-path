---
"drone-path": minor
---

Add **Help → About**: a small dialog with the drone / path lockup, the running build's version — `MAJOR.MINOR.PATCH` for releases (e.g. `0.8.1`) and `MAJOR.MINOR.PATCH+<short commit>` for every other build (e.g. `0.8.1+cb40df32`), injected at build time — an MIT license line, and a repository link that opens `MrManny/drone-path` in the default browser. The Help menu gains the entry below a separator; the dialog closes on Esc or Close like the other dialogs.
