# CLI workspace

- Own argument parsing, subcommand dispatch (`render`, `archive`, `mcp`,
  `extract-frame`), stdout/stderr formatting, and exit codes. Delegate telemetry
  and keyframes to `drone-path-core`, library indexing and search to
  `drone-path-archive`, and rendering to `drone-path-engine`.
- In the MCP server (`mcp-*.ts`), every file or directory parameter must be
  resolved and verified against the configured `--allow-root` directories via
  `mcp-paths.ts` before touching the filesystem.
- Preserve the `drone-path` package and command name, and keep the public typed
  API in sync with `package.json` exports.
- Run `npm run build:cli` from the repository root to build the CLI and its
  workspace dependencies.
