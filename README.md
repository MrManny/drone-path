# Drone Path

[Official website](https://www.dronepath.dev/)

Render flight-path map videos from DJI drone recordings (DJI Neo 2 and similar):
the actual flight path on a 2D map, ready to overlay over the drone recording.
You can also index a local recording library, search flights by location or camera
gaze, export combined tracks or standalone HTML maps with selectable basemaps, and
expose your library to AI agents via an MCP server.

Drone Path reads geo-coordinates from DJI's telemetry in two ways:

- **Embedded CAM meta (DVTM)** (DJI's protobuf stream) when the recording has one.
- **`.SRT` sidecar** next to the recording when no CAM meta stream is present.

It is a CLI tool first so scripts and agents can drive it, paired with a
[desktop app](docs/user/desktop-app.md) for humans to browse a multi-clip
[recording archive](docs/user/archive.md), review flights, and export overlays
on a synchronized timeline.

![Desktop app: a drone recording beside the synchronized flight map](docs/images/app-main-window.jpg)

*The desktop app playing a recording: the video beside the synchronized flight
map, with the flight trail, drone position, and telemetry readout strip on one
shared timeline.*

## Quick start

```sh
# Render a flight-path map overlay (writes out/my-flight_map.mp4)
npx drone-path "my-flight.mp4"

# Topographic map with altitude and speed HUD
npx drone-path "my-flight.mp4" --style topo --hud heading,alt,speed

# Export a flight track alongside the render (.gpx, .geojson, .kml, .kmz, or .json)
npx drone-path "my-flight.mp4" --track-out "my-flight.gpx"
```

Requirements: Node.js 24 or 26 and FFmpeg/FFprobe (bundled with the desktop app
and the npm package, overridable via `--ffmpeg`/`--ffprobe`, with a `PATH`
fallback). See [Getting started](docs/user/getting-started.md) for all install
options.

### Recording library & spatial search (`archive`)

Index a local folder of MP4 recordings into a local SQLite archive to query
flights, kinematic shot segments, and camera footprints, or export combined maps
and tracks:

```sh
# Index a folder recursively (rescans reuse unchanged clips)
npx drone-path archive scan <folder> --recurse --json

# List clips, disconnected media, or consecutive clips grouped into flights
npx drone-path archive list --status offline --json
npx drone-path archive list --group-by flight

# Find each clip's closest pass (or DVTM camera gaze footprint) near a point
npx drone-path archive near 46.62,14.31 --radius 250 --include-gaze --json

# Export a standalone HTML map or combined track file, redacting launch/landing zones
npx drone-path archive export-map flights.html --redact-launch 150
npx drone-path archive export-tracks flights.gpx --redact-launch 150
```

See the [CLI manual](docs/user/cli.md#scan-a-recording-library) for all filters,
shot-segment queries, and record formats.

### MCP server for AI agents (`mcp`)

Expose archive search, telemetry inspection, keyframe extraction, NLE timeline
marker export, and map video rendering over stdio JSON-RPC 2.0:

```sh
npx drone-path mcp --allow-root <dir> [--archive-db <path>]
```

`--allow-root` is required and strictly confines every file and folder tool to
the configured directories. See [MCP server](docs/user/cli.md#mcp-server) in the
CLI manual for the full tool catalog.

## Desktop app

Grab the packaged desktop app (Windows NSIS installer or portable exe, Linux
AppImage) from [GitHub Releases](https://github.com/MrManny/drone-path/releases),
or run `npm run build && npm run app` from a checkout.

The app supports two connected modes: **Archive** for indexing watched folders,
browsing inferred flights on a multi-flight map, searching **"What filmed here?"**
by location or camera gaze, filtering by shot type or smoothness, managing
offline drives, and exporting combined tracks or interactive HTML maps; and
**Review** for inspecting a recording beside its synchronized flight map (or
corner map overlay) on one shared timeline. See the
[Desktop app guide](docs/user/desktop-app.md) and
[Archive workspace guide](docs/user/archive.md).

## User manual

The user manual lives in [docs/user/](docs/user/README.md) and ships inside the
desktop app as offline help:

- [Getting started](docs/user/getting-started.md) — requirements, install options, and your first render.
- [Desktop app](docs/user/desktop-app.md) — loading a recording, reviewing a flight, exporting video, and saving telemetry JSON.
- [Archive workspace](docs/user/archive.md) — watched folders, multi-flight map, point search, filters, offline drives, and archive exports.
- [Keyboard shortcuts](docs/user/keyboard-shortcuts.md) — every shortcut of the review player at a glance.
- [CLI usage](docs/user/cli.md) — rendering, archive indexing/search, MCP server, and track exports.
- [CLI and config reference](docs/user/cli-reference.md) — every option and config key with its default.
- [Config file](docs/user/config-file.md) — where `.dronepath.json` is found and how defaults apply.
- [Tiles and attribution](docs/user/tiles-and-attribution.md) — map sources, attribution, and tile caching.

## Development & repository layout

Run `npm ci`, `npm run lint`, `npm test`, and `npm run build` from the
repository root. All workspaces share a single lockfile and version in lockstep.

| Workspace | Package | Owns |
| --- | --- | --- |
| [`packages/core`](packages/core/) | `drone-path-core` | Telemetry extraction (DVTM & SRT), spatial/gaze math, track & NLE exports, and tool discovery |
| [`packages/archive`](packages/archive/) | `drone-path-archive` | Recording library indexing, spatial/gaze queries, flight grouping, and archive exports |
| [`packages/engine`](packages/engine/) | `drone-path-engine` | Option vocabulary, map tiles, headless browser rendering, and video pipeline |
| [`packages/cli`](packages/cli/) | `drone-path` | The `drone-path` command (`render`, `archive`, `mcp`, `extract-frame`) and typed CLI API |
| [`packages/tooling`](packages/tooling/) | `drone-path-tooling` | Manual, JSON schema, CLI reference, and build identity generators |
| [`apps/desktop`](apps/desktop/) | `drone-path-desktop` | Electron shell, Next.js UI, localization catalogs, and desktop packaging |

To run the CLI from a checkout after `npm ci`:

```sh
npm run build:cli
node packages/cli/bin/drone-path.mjs "my-flight.mp4"
```

If you want or need specific features, feel free to open an issue in this
repository's issue tracker.

## License

MIT — see [LICENSE](LICENSE).
