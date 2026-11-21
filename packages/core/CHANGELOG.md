# drone-path-core

## 1.0.0

- **New:** Support archive filtering, nearest-track and camera-footprint
  queries, flight grouping, and flight-group track/map exports with optional
  launch-area redaction.
- **New:** Faster DJI CAM meta telemetry extraction by reusing recording probes
  and reading supported MP4 sample tables directly.
- **Fixed:** Reduce repeated directory reads when scanning for SRT sidecars.
- **Fixed:** `.SRT` no-lock gaps now preserve the nearest valid fix's speed and
  heading instead of dropping to zero or the default heading, and two-fix
  tracks compute forward-difference speed and course-over-ground heading.
- **Fixed:** Multi-worker exports apply proper encode backpressure, cancel
  in-flight tile pre-warming cleanly, deduplicate tile cache writes atomically,
  and handle Windows process and server cleanup reliably.
