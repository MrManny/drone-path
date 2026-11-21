---
"drone-path-engine": patch
---

Respect `"outDir": null` in `.dronepath.json` and config overrides so outputs are placed beside their source recordings instead of falling back to `"out"`. Also report type errors rather than missing-key errors when `null` is supplied for non-nullable settings keys.
