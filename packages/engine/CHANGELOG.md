# drone-path-engine

## 1.1.0

- **Fixed:** Improve map attribution contrast over light tiles.

## 1.0.0

- **New:** Faster DJI CAM meta telemetry extraction by reusing recording probes
  and reading supported MP4 sample tables directly.
- **Fixed:** Multi-worker exports apply proper encode backpressure, cancel
  in-flight tile pre-warming cleanly, deduplicate tile cache writes atomically,
  and handle Windows process and server cleanup reliably.
- **Fixed:** Timeline loop dragging clamps to live bounds without leaking
  listeners or map timers.
- **Fixed:** `"outDir": null` in `.dronepath.json` or config overrides now
  writes outputs beside their source recordings instead of falling back to
  `"out"`, and `null` for non-nullable settings keys reports a type error.
