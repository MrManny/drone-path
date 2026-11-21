---
"drone-path-core": patch
"drone-path-engine": patch
---

Speed up DJI CAM meta telemetry extraction by reusing recording probes and reading supported MP4 sample tables directly. Other layouts continue to use FFmpeg, with binary output read in memory.
