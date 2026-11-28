# drone-path-archive

## 1.2.1

- **Internal:** Read flight start timestamps only for the flights in the current query.

## 1.2.0

- **New:** Persist clip-wide sharpness timelines in the SQLite archive with
  cached reuse, bounded offline queries, and NDJSON export.
- **New:** Provide decimated flight overviews for multi-flight map
  rendering alongside full-detail track queries.

## 1.1.1

- **Fixed:** Archive HTML maps open with OpenTopoMap and let viewers switch to
  Esri World Imagery with an ArcGIS API key or turn the basemap off.

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
