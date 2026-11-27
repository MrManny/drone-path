import fs from 'node:fs';

import { Command, Option } from 'commander';
import { scanArchive } from 'drone-path-archive/indexed-scan';
import { archiveDbPath } from 'drone-path-archive/paths';
import { analyzeArchiveSharpness } from 'drone-path-archive/sharpness';
import { requireFfmpegTools } from 'drone-path-core/ffmpeg';
import { resolveFfmpegTools } from 'drone-path-core/ffmpeg-tools';
import type { SharpnessAnalysisMode } from 'drone-path-core/sharpness';

import { addArchiveQueries, archiveCommand } from './archive-query-cli.js';

function positiveInt(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) throw new Error('expected a positive integer');
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('expected a positive integer');
  return value;
}

function unitRatio(text: string): number {
  const value = Number(text.trim());
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('expected a number between 0 and 1');
  }
  return value;
}

export async function runArchive(argv: string[]): Promise<void> {
  const program = new Command('drone-path archive')
    .description('Inspect a library of drone recordings.')
    .exitOverride();
  const scan = archiveCommand(program.command('scan'))
    .description('Scan folders for drone recordings.')
    .argument('<dirs...>', 'folders to scan for recordings')
    .option('--recurse', 'include subfolders')
    .option('--prune', 'remove missing recordings from the index')
    .option('--json', 'write one JSON record per clip to stdout')
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

  const analyzeSharpness = archiveCommand(program.command('analyze-sharpness'))
    .description('Analyze and store clip-wide luminance sharpness timelines in the archive.')
    .argument('<video>', 'recording video file')
    .addOption(
      new Option('--mode <mode>', 'sampling mode: sampled (1/sec) or every-frame')
        .choices(['sampled', 'every-frame'])
        .default('sampled'),
    )
    .option('--analysis-width <px>', 'width in pixels for luminance analysis', positiveInt)
    .option('--min-edge-coverage <ratio>', 'minimum edge coverage ratio in [0, 1]', unitRatio)
    .option('--force', 're-run analysis even if a matching cached run exists')
    .option('--ffmpeg <path>', 'path to the ffmpeg executable')
    .option('--ffprobe <path>', 'path to the ffprobe executable')
    .option('--json', 'write the analysis summary as JSON to stdout')
    .action(async (video: string) => {
      const opts = analyzeSharpness.opts<{
        archiveDb?: string;
        mode: SharpnessAnalysisMode;
        analysisWidth?: number;
        minEdgeCoverage?: number;
        force?: boolean;
        ffmpeg?: string;
        ffprobe?: string;
        json?: boolean;
      }>();
      const controller = new AbortController();
      const interrupt = () => controller.abort(new Error('sharpness analysis canceled'));
      process.on('SIGINT', interrupt);
      try {
        const result = await analyzeArchiveSharpness(archiveDbPath(opts.archiveDb), video, {
          mode: opts.mode,
          analysisWidth: opts.analysisWidth,
          minEdgeCoverage: opts.minEdgeCoverage,
          force: opts.force,
          signal: controller.signal,
          getTools: async () => {
            const tools = resolveFfmpegTools({
              ffmpeg: opts.ffmpeg ?? null,
              ffprobe: opts.ffprobe ?? null,
            });
            await requireFfmpegTools(tools, controller.signal);
            return tools;
          },
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result) + '\n');
        } else {
          const state = result.cached ? 'cached' : 'fresh';
          process.stdout.write(
            `${result.clip.path}: ${result.run.sampleCount} sample(s) ` +
              `(mode ${result.run.settings.mode}, stride ${result.run.settings.stride}, ${state})\n`,
          );
        }
        process.stderr.write(
          `[drone-path] ${result.cached ? 'reused' : 'stored'} ${result.run.sampleCount} sharpness sample(s) for ${result.clip.path}\n`,
        );
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
