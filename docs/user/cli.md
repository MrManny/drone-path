# CLI usage

## Syntax

```sh
drone-path <inputs...> [options]
```

`<inputs...>` are `.mp4` files and/or folders (folders are scanned for `*.mp4`, optionally with `--recurse`). Every recording is processed independently.

## Examples

```sh
# quick conversion: one video, all default settings
drone-path "flight.mp4"

# full flight-path video: topographic map and the complete HUD
# (heading arrow + altitude + speed chips)
drone-path "flight.mp4" --style topo --hud heading,alt,speed

# custom trail color: RGB or RGBA hex (the # is optional), e.g. when
# the default trail color blends into the footage
drone-path "flight.mp4" --trail-color e63946
drone-path "flight.mp4" --style topo --trail-color "#e63946cc"
```

## Example output

All frames below are from the same recording:

![Source footage: autumn forest and mountain panorama](../images/example-source-frame.jpg)

*Source footage — the flight recording the examples below are rendered from.*

![Default output: satellite map with growing trail and heading arrow](../images/example-map-satellite.jpg)

*Default settings (first two commands): satellite map, growing trail and heading arrow.*

![Topographic output with heading, altitude and speed chips](../images/example-map-topo-hud.jpg)

*`--style topo --hud heading,alt,speed` (third command): topographic map with heading, altitude and speed chips.*

The heading arrow shows drone yaw when the CAM meta (DVTM) stream provides it; otherwise the yaw is computed from the track.

## Telemetry JSON export

`--telemetry-json <file>` writes one JSON document with the raw per-frame telemetry alongside the render. The document contains:

- a schema header (declared proto schema, source, heading mode, frame count, gimbal device constants);
- exactly one record per source frame with the time, position, altitude, body and gimbal attitude, heading and camera exposure values the telemetry source decoded.

Values the source does not carry are omitted from the record — absent keys, never `null` — and zero-valued attitudes the wire skipped (proto3 zero-omission) are exported as `0.0`. The one exception is `headingDeg`: it keeps the same back-filled heading the map arrow renders, and `headingSource` says whether the heading came from drone yaw or was derived from the track.

The document follows the checked-in `docs/telemetry-json.schema.json`; `SensorTemperature` and the semantics-undecoded DVTM fields are deliberately excluded. The run must cover a single recording; skipped recordings (`--skip-existing`) write no document. The document always covers the whole recording: a frame range applied to the render limits only the video, never the exported telemetry.

## Options and reference

Run `npx drone-path --help` for the built-in overview. The complete table of options and config keys lives in [CLI and config reference](cli-reference.md); persistent settings are covered in [Config file](config-file.md).
