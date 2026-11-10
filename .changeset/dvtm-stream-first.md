---
"drone-path": minor
---

Telemetry now comes from the embedded CAM meta (DVTM) stream whenever the recording has one; the `.SRT` sidecar is only used when no CAM meta stream is present. A CAM meta stream without GPS positions fails the run with a clear error instead of silently falling back to the sidecar.
