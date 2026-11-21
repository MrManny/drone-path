# Core workspace

- Import shared core modules through `drone-path-core/<module>`.
- Preserve the embedded CAM meta route when a recording has that stream. Use
  the SRT sidecar only when the recording has no CAM meta stream. Empty
  telemetry from an existing stream is an extraction error.
- Keep frame ranges and telemetry contracts independent of rendering, CLI
  options, and Electron.
- Keep external-tool discovery here. FFmpeg and FFprobe run as separate
  processes and may be overridden by callers.
