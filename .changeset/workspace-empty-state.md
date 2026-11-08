---
"neo2-flightpath": minor
---

Open straight into the review workspace: the landing screen is gone and no tile
warm-up stands between you and the footage. Before a recording is loaded the
workspace shows its full disabled row skeleton with the accent **Open…** call to
action in the footage pane, a quiet "No telemetry yet" map pane and a "No
recording loaded" status bar. A picked recording loads right into the player —
probe, telemetry, view plan — with the map's tiles streaming on demand (the CLI
render path and the in-app export still prefetch their tiles before rendering).
