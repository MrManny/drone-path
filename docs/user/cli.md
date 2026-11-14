# CLI usage

## Syntax

```sh
drone-path <inputs...> [options]
```

`<inputs...>` are `.mp4` files and/or folders (folders are scanned for `*.mp4`, optionally with `--recurse`). Every recording is processed independently.

## Examples

```sh
# quick conversion: one recording, all default settings
drone-path "flight.mp4"

# full flight-path video: topographic map and the complete HUD
# (heading arrow + altitude + speed chips)
drone-path "flight.mp4" --style topo --hud heading,alt,speed

# custom trail color: RGB or RGBA hex (the # is optional), e.g. when
# the default trail color blends into the map
drone-path "flight.mp4" --trail-color e63946
drone-path "flight.mp4" --style topo --trail-color "#e63946cc"
```

## Example output

All frames below are from the same recording:

![Source recording: autumn forest and mountain panorama](../images/example-source-frame.jpg)

*The source recording the examples below are rendered from.*

![Default output: satellite map with growing trail and heading arrow](../images/example-map-satellite.jpg)

*Default settings (first two commands): satellite map, growing trail and heading arrow.*

![Topographic output with heading, altitude and speed chips](../images/example-map-topo-hud.jpg)

*`--style topo --hud heading,alt,speed` (third command): topographic map with heading, altitude and speed chips.*

The heading arrow shows drone yaw when the CAM meta (DVTM) stream provides it; otherwise the yaw is computed from the track.

## Flight track export

`--track-out <file>` writes the decoded flight track alongside the render, in the format the file extension selects:

| Extension | Format | Opens in |
|---|---|---|
| `.gpx` | GPX 1.1 track | Google Earth, QGIS, most map tools |
| `.geojson` | GeoJSON `MultiLineString` feature | QGIS, web maps |
| `.kml` | KML 2.2 | Google Earth |
| `.kmz` | zipped KML (the same document inside a `doc.kml`) | Google Earth |
| `.json` | the telemetry document (see below) | this toolchain |

Any other extension is an error — there is no silent fallback. The run must cover a single recording; skipped recordings (`--skip-existing`) write no file. The export always covers the whole recording: a frame range applied to the render limits only the video, never the track file. For the same recording and range the CLI and the desktop app write byte-identical files, and reruns of the same input write byte-identical files (including `.kmz`).

Field policy — what the track formats carry:

- **Vertices sit at decoded GPS fixes** — one per fix, never interpolated or bridged. A telemetry gap breaks the line into segments: one `<trkseg>` per segment in GPX, one line per segment in the GeoJSON `MultiLineString`, one placemark per segment in KML.
- **Altitude is the absolute/GPS altitude in meters above mean sea level** (the CAM-meta `AbsoluteAltitude`, falling back to the GPS altitude; the relative take-off altitude is never used). It appears as GPX `<ele>`, as the third coordinate of every GeoJSON position, and in every KML coordinate. Where a vertex has no altitude, GPX omits `<ele>`, GeoJSON writes a two-element position, and KML writes `0` and clamps that placemark to the ground (`clampToGround`); segments with altitude at every vertex keep `absolute` altitude.
- **Times appear only where the source carries trustworthy UTC** — never invented. Today no DJI source does: the CAM-meta device timestamp counts milliseconds since power-up and the `.SRT` cue wall-clock has no time zone, so exports carry no times. When a recording does carry trustworthy UTC, GPX adds `<time>`, GeoJSON adds `coordinateProperties.times` (the QGIS convention), and KML switches from a plain `LineString` placemark to a timed `gx:Track` per segment — the Google Earth flythrough.
- **Per-vertex speed and heading are out of scope**; the `.json` document stays the rich-data format.

## Telemetry JSON export

`--track-out <file>.json` writes one JSON document with the raw per-frame telemetry alongside the render. The document contains:

- a schema header (declared proto schema, source, heading mode, frame count, gimbal device constants);
- exactly one record per source frame with the time, position, altitude, body and gimbal attitude, heading and camera exposure values the telemetry source decoded.

Values the source does not carry are omitted from the record — absent keys, never `null` — and zero-valued attitudes the wire skipped (proto3 zero-omission) are exported as `0.0`. The one exception is `headingDeg`: it keeps the same back-filled heading the map arrow renders, and `headingSource` says whether the heading came from drone yaw or was derived from the track.

The document follows the checked-in `docs/telemetry-json.schema.json`; `SensorTemperature` and the semantics-undecoded DVTM fields are deliberately excluded. The run must cover a single recording; skipped recordings (`--skip-existing`) write no document. The document always covers the whole recording: a frame range applied to the render limits only the video, never the exported telemetry.

`--telemetry-json <file>` is a deprecated alias of `--track-out <file>.json`: it keeps writing the same document byte-for-byte and warns that it will be removed in a future version. Passing both spellings at once is an error — they normalize to one option.

**`--json` is not `--track-out data.json`:** `--json` prints one NDJSON summary line per recording on stdout (for scripting), while `--track-out data.json` writes the telemetry document to a file. They are separate options and can be combined.

## Options and reference

Run `npx drone-path --help` for the built-in overview. The complete table of options and config keys lives in [CLI and config reference](cli-reference.md); persistent settings are covered in [Config file](config-file.md).
