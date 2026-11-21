# drone-path-core

## 1.0.0

- **New:** Support archive filtering, nearest-track and camera-footprint
  queries, flight grouping, and flight-group track/map exports with optional
  launch-area redaction.
- **New:** Faster DJI CAM meta telemetry extraction by reusing recording probes
  and reading supported MP4 sample tables directly.
- **Fixed:** Reduce repeated directory reads when scanning for SRT sidecars.

## 1.0.0-rc1

### Patch Changes

- 985c93c: Preserve nearest-valid-fix speed and heading across `.SRT` no-lock gaps instead of dropping to zero or the default heading. Compute forward-difference speed and course-over-ground heading for 2-fix tracks.
- e3074df: Fix multi-worker export backpressure, forward abort signals to tile pre-warming with atomic deduplicated tile caching, and harden process/server error and cleanup handling on Windows.
