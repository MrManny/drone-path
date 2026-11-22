---
"drone-path-desktop": patch
---

Fix `ThumbSampler.dispose()` settlement and media abort, prevent `createFrameDriver` from auto-playing when paused at the end or looping on a single-frame lone `in`, seek synchronously before `play()` in `usePlayback.togglePlay()`, and key `useFilmstrip` thumbnail state by `FilmstripCache` instance.
