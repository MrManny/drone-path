# drone-path-core

## 1.0.0

### Minor Changes

- f987b1b: Filter indexed recordings by viewport, camera date, track distance, or availability with `archive list`. Use `archive near` to rank nearby tracks and find the clip-relative time of each closest pass.
- f987b1b: Group contiguous DJI recordings into inferred flights with `drone-path archive list --group-by flight`. Split continuations retain their original recording paths.
- f987b1b: Add archive camera footprint search. Use `archive near --include-gaze` to find clips whose DVTM camera data suggests they saw a point.
- f987b1b: Export indexed flight groups as offline HTML maps or GPX, GeoJSON, KML, and KMZ tracks with optional launch-area redaction.

### Patch Changes

- f987b1b: Let archive queries open an existing index while a scan holds a SQLite write reservation, and reduce repeated directory reads when scanning for SRT sidecars.
- f987b1b: Speed up DJI CAM meta telemetry extraction by reusing recording probes and reading supported MP4 sample tables directly. Other layouts continue to use FFmpeg, with binary output read in memory.

## 1.0.0-rc1

### Patch Changes

- 985c93c: Preserve nearest-valid-fix speed and heading across `.SRT` no-lock gaps instead of dropping to zero or the default heading. Compute forward-difference speed and course-over-ground heading for 2-fix tracks.
- e3074df: Fix multi-worker export backpressure, forward abort signals to tile pre-warming with atomic deduplicated tile caching, and harden process/server error and cleanup handling on Windows.
