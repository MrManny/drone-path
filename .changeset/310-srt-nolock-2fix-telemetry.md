---
"drone-path-core": patch
---

Preserve nearest-valid-fix speed and heading across `.SRT` no-lock gaps instead of dropping to zero or the default heading. Compute forward-difference speed and course-over-ground heading for 2-fix tracks.
