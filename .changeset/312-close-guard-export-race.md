---
"drone-path-desktop": patch
---

Fix window close guard deadlocking or disabling future protection when an export finishes while the confirmation prompt is open, prevent canceled exports from overwriting the output file if rendering finishes concurrently, and ensure updater restart failures are reported once.
