---
"neo2-flightpath": minor
---

Open a recording right away: the desktop app no longer waits for the map tiles around the first frame to warm up, shows no warm-up hint, and streams the map's tiles on demand — the CLI render path and the in-app export still prefetch their tiles before rendering.
