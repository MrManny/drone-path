---
"drone-path": minor
---

Rebrand to "Drone Path" (#181). **Breaking renames with no compatibility aliases** — migrate on upgrade: the CLI command is now `drone-path` (was `neo2-flightpath`), the config file is now `.dronepath.json` (was `.neo2flightpath.json`), and the tile-cache environment variable is now `DRONEPATH_TILE_CACHE` (was `NEO2_FLIGHTPATH_TILE_CACHE`). The desktop app ships as "Drone Path" with the new appId `io.github.mrmanny.dronepath`, so installed apps do not auto-update in place — uninstall the old version and install the new one; the per-user data directory moves to `drone-path` (the old one is orphaned).
