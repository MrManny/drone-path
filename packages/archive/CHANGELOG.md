# drone-path-archive

## 1.1.0

- **New:** Index shot segments and filter recordings by segment type or
  smoothness. Export shot markers as DaVinci Resolve CSV or FCPXML.

## 1.0.0

- **New:** Scan folders into a local SQLite archive index, skipping unchanged
  clips, including recordings without telemetry or GPS lock, and retaining
  missing clips as offline until pruned.
- **New:** Query indexed recordings by viewport, camera date, track distance,
  or availability, rank nearby tracks with clip-relative closest-pass times,
  and search DVTM camera footprints.
- **New:** Group contiguous DJI recordings into inferred flights and export
  flight groups as offline HTML maps or GPX, GeoJSON, KML, and KMZ tracks with
  optional launch-area redaction.
- **Fixed:** Allow archive queries to open an existing index while a scan holds
  a SQLite write reservation, and reduce repeated directory reads when scanning
  for SRT sidecars.
