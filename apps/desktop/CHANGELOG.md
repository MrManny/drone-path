# drone-path-desktop

## 1.0.0

- **Fixed:** Desktop modal dialogs keep `Tab` focus trapped reliably, timeline
  loop dragging clamps to live bounds without leaking listeners or map timers,
  window close guards no longer deadlock after an export finishes, canceled
  exports never overwrite finished files, and updater restart failures and
  duplicate save-picker triggers are handled cleanly.
- **Internal:** Updated `drone-path-core` and `drone-path-engine` to `1.0.0`.
