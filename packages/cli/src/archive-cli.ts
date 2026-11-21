import fs from 'node:fs';

import { Command } from 'commander';
import { scanArchive } from 'drone-path-archive/indexed-scan';
import { archiveDbPath } from 'drone-path-archive/paths';
import { requireFfmpegTools } from 'drone-path-core/ffmpeg';
import { resolveFfmpegTools } from 'drone-path-core/ffmpeg-tools';

import { addArchiveQueries } from './archive-query-cli.js';

export async function runArchive(argv: string[]): Promise<void> {
  const program = new Command('drone-path archive')
    .description('Inspect a library of drone recordings.')
    .exitOverride();
  const scan = program.command('scan')
    .description('Scan folders for drone recordings.')
    .argument('<dirs...>', 'folders to scan for recordings')
    .option('--recurse', 'include subfolders')
    .option('--archive-db <path>', 'override the per-user archive database path')
    .option('--prune', 'remove missing recordings from the index')
    .option('--json', 'write one JSON record per clip to stdout')
    .exitOverride()
    .action(async (dirs: string[]) => {
      const { recurse, json, archiveDb, prune } = scan.opts<{
        recurse?: boolean; json?: boolean; archiveDb?: string; prune?: boolean;
      }>();
      const controller = new AbortController();
      const interrupt = () => controller.abort(new Error('archive scan canceled'));
      process.on('SIGINT', interrupt);
      try {
        const records = await scanArchive(dirs, {
          db: archiveDbPath(archiveDb), recurse, prune, signal: controller.signal,
          getTools: async () => {
            const tools = resolveFfmpegTools({ ffmpeg: null, ffprobe: null });
            await requireFfmpegTools(tools, controller.signal);
            return tools;
          },
          onRecord: (record) => {
            process.stderr.write(`[drone-path] ${record.status}: ${record.path}\n`);
          },
        });
        if (json) for (const record of records) fs.writeSync(1, JSON.stringify(record) + '\n');
        process.stderr.write(`[drone-path] scanned ${records.length} recording(s)\n`);
      } catch (error) {
        controller.signal.throwIfAborted();
        throw error;
      } finally {
        process.off('SIGINT', interrupt);
      }
    });
  addArchiveQueries(program);
  await program.parseAsync(argv, { from: 'user' });
}
