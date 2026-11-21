# drone-path-engine

## 1.0.0-rc1

### Patch Changes

- e3074df: Fix multi-worker export backpressure, forward abort signals to tile pre-warming with atomic deduplicated tile caching, and harden process/server error and cleanup handling on Windows.
- 3e6e469: Fix timeline loop handle dragging to clamp against live loop bounds and clean up window pointer listeners on unmount, and prevent post-dispose map relayouts, leaked tile load timers, and out-of-bounds frame updates on shorter tracks.
- 1ba9971: Respect `"outDir": null` in `.dronepath.json` and config overrides so outputs are placed beside their source recordings instead of falling back to `"out"`. Also report type errors rather than missing-key errors when `null` is supplied for non-nullable settings keys.
- Updated dependencies [985c93c]
- Updated dependencies [e3074df]
  - drone-path-core@1.0.0-rc1
