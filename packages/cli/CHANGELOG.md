# drone-path

## 1.0.0

### Minor Changes

- f987b1b: Scan folders with `drone-path archive scan` and get an inventory that includes clips without telemetry or GPS lock.
- f987b1b: Archive scans now persist a local SQLite index, skip unchanged clips, and retain missing clips as offline until pruned.
- f987b1b: Filter indexed recordings by viewport, camera date, track distance, or availability with `archive list`. Use `archive near` to rank nearby tracks and find the clip-relative time of each closest pass.
- f987b1b: Group contiguous DJI recordings into inferred flights with `drone-path archive list --group-by flight`. Split continuations retain their original recording paths.
- f987b1b: Add archive camera footprint search. Use `archive near --include-gaze` to find clips whose DVTM camera data suggests they saw a point.
- f987b1b: Export indexed flight groups as offline HTML maps or GPX, GeoJSON, KML, and KMZ tracks with optional launch-area redaction.

### Patch Changes

- f987b1b: Let archive queries open an existing index while a scan holds a SQLite write reservation, and reduce repeated directory reads when scanning for SRT sidecars.
- Updated dependencies [f987b1b]
- Updated dependencies [f987b1b]
- Updated dependencies [f987b1b]
- Updated dependencies [f987b1b]
- Updated dependencies [f987b1b]
- Updated dependencies [f987b1b]
- Updated dependencies [f987b1b]
- Updated dependencies [f987b1b]
  - drone-path-archive@1.0.0
  - drone-path-core@1.0.0
  - drone-path-engine@1.0.0

## 1.0.0-rc1

### Patch Changes

- 4cc0870: Scope the repository helpers' GitHub Project status updates to issues in the current repository. Report lookup errors after project items have been read successfully.
- Updated dependencies [985c93c]
- Updated dependencies [e3074df]
- Updated dependencies [3e6e469]
- Updated dependencies [1ba9971]
  - drone-path-core@1.0.0-rc1
  - drone-path-engine@1.0.0-rc1
