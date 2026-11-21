# Engine workspace

- Import public engine modules through `drone-path-engine/<module>`.
- `src/config.ts` owns the option vocabulary. Coordinate changes with the
  CLI, desktop adapters, and generated reference.
- Keep rendering, map tiles, and browser automation here. Reuse core for
  telemetry and external-tool discovery.
