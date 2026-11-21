# drone-path-desktop

## 1.0.0

- **Internal:** Updated `drone-path-core` and `drone-path-engine` to `1.0.0`.

## 1.0.0-rc1

### Patch Changes

- 75261a8: Fix window close guard deadlocking or disabling future protection when an export finishes while the confirmation prompt is open, prevent canceled exports from overwriting the output file if rendering finishes concurrently, and ensure updater restart failures are reported once.
- e00159d: Keep `Tab` navigation trapped inside modal dialogs even when focus falls back to the page body or reaches a `<summary>` disclosure, and guard save-picker and initial settings requests against duplicate triggers, unmount races, and out-of-order responses.
- 3e6e469: Fix timeline loop handle dragging to clamp against live loop bounds and clean up window pointer listeners on unmount, and prevent post-dispose map relayouts, leaked tile load timers, and out-of-bounds frame updates on shorter tracks.
- Updated dependencies [985c93c]
- Updated dependencies [e3074df]
- Updated dependencies [3e6e469]
- Updated dependencies [1ba9971]
  - drone-path-core@1.0.0-rc1
  - drone-path-engine@1.0.0-rc1
