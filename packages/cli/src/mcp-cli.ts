import { Command } from 'commander';

import { createMcpServer } from './mcp-server.js';

interface McpCliOptions {
  archiveDb?: string;
  allowRoot?: string[];
}

export async function runMcp(argv: string[]): Promise<void> {
  const program = new Command('drone-path mcp')
    .description('Run a stdio MCP server exposing archive, telemetry, keyframe, and rendering tools.')
    .exitOverride()
    .option('--archive-db <path>', 'override the per-user archive database path')
    .requiredOption(
      '--allow-root <dir...>',
      'restrict file and folder tool access to these root directories (required)',
    );

  program.parse(argv, { from: 'user' });
  const opts = program.opts<McpCliOptions>();

  const server = createMcpServer({
    archiveDb: opts.archiveDb,
    allowedRoots: opts.allowRoot,
  });

  const onSignal = () => {
    void server.close();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    const rootCount = server.allowedRoots.length;
    process.stderr.write(`[drone-path] mcp stdio server ready (roots: ${rootCount})\n`);
    await server.start();
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
