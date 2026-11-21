# drone-path

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

## 1.0.0-rc1

### Patch Changes

- 4cc0870: Scope the repository helpers' GitHub Project status updates to issues in the current repository. Report lookup errors after project items have been read successfully.
- Updated dependencies [985c93c]
- Updated dependencies [e3074df]
- Updated dependencies [3e6e469]
- Updated dependencies [1ba9971]
  - drone-path-core@1.0.0-rc1
  - drone-path-engine@1.0.0-rc1
