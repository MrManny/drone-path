# Drone Path

This handy little tool renders flight-path map videos from DJI drone
recordings (DJI Neo 2 and similar): the actual flight path on a 2D map,
ready to overlay in your drone flight footage.

It reads geo-coordinates from DJI's telemetry in two ways:

- the embedded CAM meta (DVTM) stream (DJI's protobuf format) is used when
  the recording has one,
- otherwise an `.SRT` sidecar next to the recording is used.

It is a CLI tool first, so agents can drive it too — that's all cool with me.
For us humans, there is a [desktop app](docs/user/desktop-app.md): pick a
recording and watch its flight path on the map in sync with the footage.

## Quick start

```sh
# from GitHub
npx github:MrManny/drone-path "my-flight.mp4"

# from npm
npx drone-path "my-flight.mp4"

# topographic map, altitude + speed HUD
npx drone-path "my-flight.mp4" --style topo --hud heading,alt,speed

# per-frame telemetry JSON alongside the render (one recording per run)
npx drone-path "my-flight.mp4" --telemetry-json "my-flight.telemetry.json"
```

Output lands in the `out/` folder as `<basename>_map.mp4`; both the folder
and the name are configurable. Requirements: Node.js 24 or 26 and
ffmpeg/ffprobe — bundled with the desktop app and the npm package,
overridable via `--ffmpeg`/`--ffprobe`, with a `PATH` fallback. All
requirements and install options are in
[Getting started](docs/user/getting-started.md).

## Documentation

The user manual lives in [docs/user/](docs/user/README.md); the desktop app
ships the same pages as offline help. Highlights:

- [Getting started](docs/user/getting-started.md) — requirements, install options, and your first render.
- [Desktop app](docs/user/desktop-app.md) — loading a recording, reviewing a flight, exporting video, and saving telemetry JSON from the app.
- [Keyboard shortcuts](docs/user/keyboard-shortcuts.md) — every shortcut of the review player at a glance.
- [CLI usage](docs/user/cli.md) — inputs, examples, and example output.
- [CLI and config reference](docs/user/cli-reference.md) — every option and config key with its default.
- [Config file](docs/user/config-file.md) — where `.dronepath.json` is found and how defaults apply.
- [Tiles and attribution](docs/user/tiles-and-attribution.md) — map sources, attribution, and tile caching.

## Desktop app

For reviewing flights without the terminal, grab the packaged desktop app
(Windows NSIS installer or portable exe, Linux AppImage) from
[GitHub Releases](https://github.com/MrManny/drone-path/releases), or run
`npm run build && npm run app` from a checkout.

The app shows the footage and the synchronized flight map side by side —
swappable to a map overlay — on one shared timeline;
[the manual](docs/user/desktop-app.md) walks through loading a recording,
reviewing a flight, looping a passage, exporting, and saving the per-frame
telemetry JSON. The look settings carry over between launches.

![Desktop app: drone footage beside the synchronized flight map](docs/images/app-main-window.jpg)

*The desktop app playing a recording: footage beside the synchronized flight map,
with the flight trail, drone position and HUD chips on one shared timeline.*

## Feature requests

If you want or need specific features, feel free to open an issue in this
repository's issue tracker.

## License

MIT — see [LICENSE](LICENSE).
