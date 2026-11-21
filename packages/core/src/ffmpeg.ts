import { ERR_NO_FRAME_RATE } from './errors.js';
import { runTool } from './exec-tool.js';
import { framesForSeconds, parseFpsRate } from './frametime.js';
import type { Fps } from './frametime.js';
import { FFMPEG_TOOL_NAMES } from './ffmpeg-tools.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';

export interface VideoProbe {
  fps: Fps;
  frames: number;
  durationSec: number;
  width: number;
  height: number;
}

const INSTALL_HINT =
  'point --ffmpeg/--ffprobe at your executables, or install ffmpeg (includes ' +
  'ffprobe) and make sure both are on PATH, e.g. "winget install Gyan.FFmpeg" ' +
  '(Windows), "brew install ffmpeg" (macOS) or "apt install ffmpeg" (Linux)';

const FFPROBE_MAX_BUFFER = 64 * 1024 * 1024;
const TOOL_VERSION_MAX_BUFFER = 1 << 20;

export async function requireFfmpegTools(tools: FfmpegToolPaths): Promise<void> {
  for (const tool of FFMPEG_TOOL_NAMES) {
    const command = tools[tool];
    try {
      await runTool(command, ['-version'], { maxBuffer: TOOL_VERSION_MAX_BUFFER });
    } catch (e) {
      throw new Error(
        `${tool} is required but could not be run (${command}) - ${INSTALL_HINT}`,
        { cause: e },
      );
    }
  }
}

export async function ffprobeJson(
  tools: FfmpegToolPaths,
  videoPath: string,
  args: string[],
): Promise<Record<string, unknown>> {
  const { stdout } = await runTool(
    tools.ffprobe,
    ['-v', 'error', ...args, videoPath],
    { maxBuffer: FFPROBE_MAX_BUFFER },
  );
  return JSON.parse(stdout || '{}') as Record<string, unknown>;
}

interface ProbeStream {
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  width?: number;
  height?: number;
}

interface ProbeFormat {
  duration?: string;
}

export function firstVideoStream(j: Record<string, unknown>): ProbeStream {
  return ((j['streams'] as ProbeStream[] | undefined) ?? [])[0] ?? {};
}

export async function probeVideo(
  tools: FfmpegToolPaths,
  videoPath: string,
  log: (msg: string) => void = () => {},
): Promise<VideoProbe> {
  const j = await ffprobeJson(tools, videoPath, [
    '-select_streams', 'v:0',
    '-show_entries',
    'stream=r_frame_rate,avg_frame_rate,nb_frames,width,height:format=duration',
    '-of', 'json',
  ]);
  const stream = firstVideoStream(j);
  const format = (j['format'] as ProbeFormat | undefined) ?? {};

  const fps =
    parseFpsRate(stream.r_frame_rate) ??
    parseFpsRate(stream.avg_frame_rate);
  if (!fps) throw new Error(ERR_NO_FRAME_RATE);

  const durationSec = Number.parseFloat(format.duration ?? '');
  let frames = Number.parseInt(stream.nb_frames ?? '', 10);
  if (!Number.isFinite(frames) || frames <= 0) {
    frames = framesForSeconds(fps.value, durationSec);
    log('warning: nb_frames missing, using duration x fps');
  }
  if (!Number.isFinite(frames) || frames <= 0) {
    throw new Error(
      `could not determine the frame count of ${videoPath} ` +
        '(nb_frames missing and duration unusable)',
    );
  }
  return {
    fps,
    frames,
    durationSec,
    width: stream.width ?? 0,
    height: stream.height ?? 0,
  };
}
