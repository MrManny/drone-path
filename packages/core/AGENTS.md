# Core workspace

- Import shared core modules through `drone-path-core/<module>`.
- Telemetry priority: preserve the embedded CAM meta (DVTM) route when a
  recording has that stream; fall back to the `.SRT` sidecar only when no CAM
  meta stream exists. Empty telemetry from an existing stream is an extraction
  error.
- Keep telemetry contracts, frame ranges, spatial/gaze math, flight grouping,
  kinematic shot segmentation, launch redaction, track serialization (`.gpx`,
  `.geojson`, `.kml`, `.kmz`, telemetry `.json`), and NLE markers pure and
  independent of rendering, CLI options, and Electron.
- Keep external-tool discovery and child-process execution here (`ffmpeg-tools.ts`,
  `ffmpeg.ts`, `keyframes.ts`). FFmpeg and FFprobe run as separate processes and
  may be overridden by callers.
