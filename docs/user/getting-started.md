# Getting started

## What it does

Drone Path renders flight-path map-overlay videos from DJI drone recordings (the DJI Neo 2 and similar) at exactly the source frame rate and frame count. Telemetry comes from the embedded CAM meta (DVTM) stream when the recording has one, otherwise from the `.SRT` sidecar. A recording with a CAM meta stream never falls back to the sidecar: when that stream carries no GPS positions, the run fails with a clear error.

![Desktop app: a drone recording beside the synchronized flight map](../images/app-main-window.jpg)

*The desktop app playing a recording: the recording beside the synchronized flight map, with the flight trail, drone position and HUD chips on one shared timeline.*

## Getting it

Run it from npm with `npx drone-path`, or from GitHub with `npx github:MrManny/drone-path`. To work from a checkout instead, clone the repository and run `npm ci`.

## Requirements

- **Node.js 24 or 26**
- **ffmpeg + ffprobe** for telemetry extraction and video encoding: bundled with the desktop app and the npm package, overridable with `--ffmpeg <path>` / `--ffprobe <path>`, and looked up on `PATH` as a fallback.
  - Installing (including a first `npx drone-path` run) downloads the binaries in a postinstall step (~250 MB for both tools).
  - With `--omit=optional` or offline installs the `PATH` fallback applies: `winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg` on macOS, `apt install ffmpeg` on Linux.
- **Google Chrome or Microsoft Edge** for rendering from the CLI. The desktop app embeds Chromium and needs no system browser. With neither browser installed, `npx playwright install chromium` works too. Any Chromium executable can be forced with `--browser <path>`.
- **Internet on the first run**: map tiles are fetched and then cached permanently (see [Tiles and attribution](tiles-and-attribution.md)).

## Quick start

```sh
# from GitHub
npx github:MrManny/drone-path "my-flight.mp4"

# from npm
npx drone-path "my-flight.mp4"

# topographic map, altitude + speed HUD
npx drone-path "my-flight.mp4" --style topo --hud heading,alt,speed
```

Output lands in the `out/` folder as `<basename>_map.mp4`; both the folder and the name are configurable. For inputs and options in depth, see [CLI usage](cli.md).

## Where to go next

- [Desktop app](desktop-app.md) — reviewing flights and exporting video from the app.
- [CLI usage](cli.md) — inputs, examples, and example output.
