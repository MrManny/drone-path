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
  /** Original camera metadata. Its accuracy and time zone are unverified. */
  creationTime?: string;
  camMeta?: CamMetaStream | null;
}

export interface CamMetaStream {
  index: number;
  trackId?: number;
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
  index?: number;
  id?: string;
  codec_type?: string;
  tags?: { handler_name?: string };
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  width?: number;
  height?: number;
}

interface ProbeFormat {
  duration?: string;
  tags?: { creation_time?: string };
}

export function firstVideoStream(j: Record<string, unknown>): ProbeStream {
  return ((j['streams'] as ProbeStream[] | undefined) ?? [])[0] ?? {};
}

export function findCamMetaStream(
  probe: Record<string, unknown>,
): CamMetaStream | null {
  const streams = (probe['streams'] ?? []) as ProbeStream[];
  const stream = streams.find(({ index, codec_type, tags }) =>
    typeof index === 'number' && (codec_type === undefined || codec_type === 'data') &&
    tags?.handler_name === 'CAM meta',
  );
  if (stream?.index === undefined) return null;
  const trackId = Number(stream.id);
  return Number.isSafeInteger(trackId) && trackId > 0
    ? { index: stream.index, trackId }
    : { index: stream.index };
}

export async function probeVideo(
  tools: FfmpegToolPaths,
  videoPath: string,
  log: (msg: string) => void = () => {},
): Promise<VideoProbe> {
  const j = await ffprobeJson(tools, videoPath, [
    '-show_entries',
    'stream=index,id,codec_type,r_frame_rate,avg_frame_rate,nb_frames,width,height' +
      ':stream_tags=handler_name:format=duration:format_tags=creation_time',
    '-of', 'json',
  ]);
  const streams = (j['streams'] ?? []) as ProbeStream[];
  const stream = streams.find(({ codec_type }) => codec_type === 'video') ?? {};
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
    creationTime: format.tags?.creation_time,
    camMeta: findCamMetaStream(j),
  };
}
