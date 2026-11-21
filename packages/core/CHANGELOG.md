# drone-path-core

## 1.0.0-rc1

### Patch Changes

- 985c93c: Preserve nearest-valid-fix speed and heading across `.SRT` no-lock gaps instead of dropping to zero or the default heading. Compute forward-difference speed and course-over-ground heading for 2-fix tracks.
- e3074df: Fix multi-worker export backpressure, forward abort signals to tile pre-warming with atomic deduplicated tile caching, and harden process/server error and cleanup handling on Windows.
