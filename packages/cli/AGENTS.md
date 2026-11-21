# CLI workspace

- Keep argument handling, stdout and stderr behavior, and exit codes here.
  Delegate telemetry extraction to core and rendering to engine.
- Preserve the `drone-path` package and command name. Keep the public typed API
  in sync with the CLI workspace's package exports.
- From the repository root, run `npm run build:cli` to build the CLI and its
  shared dependencies.
