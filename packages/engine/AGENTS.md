# Engine workspace

- Import public engine modules through `drone-path-engine/<module>`.
- `src/config.ts` owns the canonical option vocabulary and defaults. Coordinate
  any option change with the CLI, desktop adapters, and generated reference
  (`npm run docs:reference`).
- Keep render planning, map tile fetching/caching, local asset serving, headless
  browser automation, and video encoding here. Reuse `drone-path-core` for
  telemetry, track writing, and external-tool discovery.
