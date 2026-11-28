# drone-path

## 1.2.1

- **Fixed:** Find `extract-frame` in top-level `drone-path --help` and in the
  CLI reference, which covers frame selection and sharpness scoring.

## 1.2.0

- **New:** Pass `--sharpness` to `drone-path extract-frame` (or `sharpness`
  to MCP `clip_extract_keyframes`) to score extracted keyframes with FFmpeg
  `blurdetect`.
- **New:** Run `drone-path archive analyze-sharpness` and
  `drone-path archive sharpness` (and MCP `archive_analyze_sharpness` /
  `archive_get_sharpness`) for clip-wide SQLite sharpness timelines,
  bounded offline queries, and NDJSON export.

## 1.1.1

- **Fixed:** Archive HTML maps open with OpenTopoMap and let viewers switch to
  Esri World Imagery with an ArcGIS API key or turn the basemap off.
- **New:** Use `drone-path archive export-map --offline` to export tracks and camera
  footprints without making tile requests.

## 1.1.0

- **New:** Run `drone-path mcp` over stdio to scan and query recordings, read
  telemetry, extract keyframes, export markers, and render map overlays. Set
  `--allow-root` to choose which folders the server can access. MCP exports
  protect existing files by default.
- **New:** Use `drone-path extract-frame` to save JPEGs with telemetry
  snapshots and `drone-path archive export-markers` to export shot markers.
  Filter `archive list` with `--segment-type` or `--min-smoothness`.

## 1.0.0

- **New:** Scan folders into a local SQLite archive index with
  `drone-path archive scan`. Scans skip unchanged clips, include recordings
  without telemetry or GPS lock, and retain missing clips as offline until
  pruned.
- **New:** Query indexed recordings with `archive list` (filtering by viewport,
  camera date, track distance, or availability) and rank nearby tracks with
  `archive near`, including clip-relative closest-pass times and camera
  footprint search (`--include-gaze`) for DVTM clips.
- **New:** Group contiguous DJI recordings into inferred flights with
  `archive list --group-by flight`, and export indexed flight groups as
  offline HTML maps or GPX, GeoJSON, KML, and KMZ tracks with optional
  launch-area redaction.
- **Fixed:** Archive queries can now open an existing index while a scan holds a
  SQLite write reservation, and SRT sidecar scanning avoids repeated directory
  reads.
- **Internal:** Scoped GitHub Project status helpers to issues in the current
  repository.
