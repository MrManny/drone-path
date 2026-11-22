# Archive workspace

- Import public archive modules through `drone-path-archive/<module>`.
- Own recording discovery, incremental fingerprinting (`indexed-scan.ts`), the
  SQLite archive (`store.ts`), spatial/gaze/segment queries (`query.ts`), and
  combined map/track exports (`export-map.ts`, `export.ts`). Reuse
  `drone-path-core` for telemetry, spatial math, flight grouping, shot
  segmentation, and launch redaction.
- Keep unverified camera creation tags (`cameraCreationTime`) separate from
  filesystem timestamps (`mtimeMs`).
- Keep `ArchiveStore` schema migrations (`ARCHIVE_SCHEMA_VERSION`) deterministic
  and transactional, and apply launch/landing redaction before any exported
  geometry leaves the store.
