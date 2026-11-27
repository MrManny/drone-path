import { Command } from 'commander';

import { requireFfmpegTools } from 'drone-path-core/ffmpeg';
import { resolveFfmpegTools } from 'drone-path-core/ffmpeg-tools';
import { extractKeyframes, parseKeyframeSpecs } from 'drone-path-core/keyframes';

interface ExtractFrameOptions {
  at: string;
  maxWidth?: number;
  outDir?: string;
  sharpness?: boolean;
  ffmpeg?: string;
  ffprobe?: string;
  json?: boolean;
}

function parseMaxWidth(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error('expected a positive integer for --max-width');
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('expected a positive integer for --max-width');
  }
  return value;
}

export async function runExtractFrame(argv: string[]): Promise<void> {
  const program = new Command('drone-path extract-frame')
    .description('Extract targeted JPEG keyframes and telemetry snapshots from a recording.')
    .exitOverride()
    .argument('<video>', 'recording video file')
    .requiredOption('--at <specs>', 'comma-separated timestamps (s) or frames (fN, frame:N)')
    .option('--max-width <px>', 'maximum output width in pixels, preserving aspect ratio', parseMaxWidth)
    .option('--out-dir <dir>', 'output directory (defaults to video directory)')
    .option('--sharpness', 'analyze decoded luminance sharpness for each extracted frame')
    .option('--ffmpeg <path>', 'path to the ffmpeg executable')
    .option('--ffprobe <path>', 'path to the ffprobe executable')
    .option('--json', 'write extracted keyframes JSON array to stdout');

  program.parse(argv, { from: 'user' });
  const [video] = program.args;
  const opts = program.opts<ExtractFrameOptions>();
  const requests = parseKeyframeSpecs(opts.at);

  const tools = resolveFfmpegTools({
    ffmpeg: opts.ffmpeg ?? null,
    ffprobe: opts.ffprobe ?? null,
  });

  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('keyframe extraction canceled'));
  process.on('SIGINT', interrupt);
  try {
    await requireFfmpegTools(tools, controller.signal);
    const keyframes = await extractKeyframes(video, {
      at: requests,
      maxWidth: opts.maxWidth,
      outDir: opts.outDir,
      sharpness: opts.sharpness,
      tools,
      signal: controller.signal,
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(keyframes) + '\n');
      return;
    }
    for (const kf of keyframes) {
      const sharpnessSuffix = kf.sharpness
        ? `, sharpness ${kf.sharpness.sharpnessScore === null ? 'n/a' : kf.sharpness.sharpnessScore.toFixed(2)} (edge coverage ${(kf.sharpness.edgeCoverage * 100).toFixed(2)}%)`
        : '';
      process.stdout.write(
        `${kf.path} (frame ${kf.frame}, ${kf.tSec.toFixed(3)}s, ${kf.width}x${kf.height}${sharpnessSuffix})\n`,
      );
    }
    process.stderr.write(`[drone-path] extracted ${keyframes.length} keyframe(s)\n`);
  } catch (error) {
    controller.signal.throwIfAborted();
    throw error;
  } finally {
    process.off('SIGINT', interrupt);
  }
}
