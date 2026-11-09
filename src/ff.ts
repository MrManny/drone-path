import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { FfToolPaths } from './fftools.js';

const execFileAsync = promisify(execFile);

export interface Fps {
  num: number;
  den: number;
  value: number;
  str: string;
}

export interface VideoProbe {
  fps: Fps;
  frames: number;
  durationSec: number;
  width: number;
  height: number;
}

export interface VerifyResult {
  frames: number;
  fps: string | null;
  ok: boolean;
}

const INSTALL_HINT =
  'point --ffmpeg/--ffprobe at your executables, or install ffmpeg (includes ' +
  'ffprobe) and make sure both are on PATH, e.g. "winget install Gyan.FFmpeg" ' +
  '(Windows), "brew install ffmpeg" (macOS) or "apt install ffmpeg" (Linux)';

const FFPROBE_MAX_BUFFER = 64 * 1024 * 1024;

export async function requireTools(tools: FfToolPaths): Promise<void> {
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    const command = tools[tool];
    try {
      await execFileAsync(command, ['-version'], { maxBuffer: 1 << 20 });
    } catch (e) {
      throw new Error(
        `${tool} is required but could not be run (${command}) - ${INSTALL_HINT}`,
        { cause: e },
      );
    }
  }
}

export async function ffprobeJson(
  tools: FfToolPaths,
  videoPath: string,
  args: string[],
): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(
    tools.ffprobe,
    ['-v', 'error', ...args, videoPath],
    { maxBuffer: FFPROBE_MAX_BUFFER },
  );
  return JSON.parse(stdout || '{}') as Record<string, unknown>;
}

function parseRate(str: string): { num: number; den?: number } | null {
  const [num, den] = str.split('/').map(Number);
  return Number.isFinite(num) ? { num, den } : null;
}

function parseFpsRate(str?: string): Fps | null {
  const rate = str ? parseRate(str) : null;
  if (!rate || !Number.isFinite(rate.den) || rate.den === 0 || rate.num === 0) {
    return null;
  }
  const { num } = rate;
  const den = rate.den as number;
  return {
    num,
    den,
    value: num / den,
    str: den === 1 ? String(num) : `${num}/${den}`,
  };
}

function parseCount(text: string | undefined): number {
  return Number.parseInt(text ?? '', 10);
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

function firstStream(j: Record<string, unknown>): ProbeStream {
  return ((j['streams'] as ProbeStream[] | undefined) ?? [])[0] ?? {};
}

export async function probeVideo(
  tools: FfToolPaths,
  videoPath: string,
  log: (msg: string) => void = () => {},
): Promise<VideoProbe> {
  const j = await ffprobeJson(tools, videoPath, [
    '-select_streams', 'v:0',
    '-show_entries',
    'stream=r_frame_rate,avg_frame_rate,nb_frames,width,height:format=duration',
    '-of', 'json',
  ]);
  const stream = firstStream(j);
  const format = (j['format'] as ProbeFormat | undefined) ?? {};

  const fps =
    parseFpsRate(stream.r_frame_rate) ??
    parseFpsRate(stream.avg_frame_rate);
  if (!fps) throw new Error('could not determine the frame rate of the video');

  const durationSec = Number.parseFloat(format.duration ?? '');
  let frames = parseCount(stream.nb_frames);
  if (!Number.isFinite(frames) || frames <= 0) {
    frames = Math.round(durationSec * fps.value);
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

export async function verifyOutput(
  tools: FfToolPaths,
  outPath: string,
  frames: number,
  fpsValue: number,
): Promise<VerifyResult> {
  const j = await ffprobeJson(tools, outPath, [
    '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_frames,r_frame_rate',
    '-of', 'json',
  ]);
  const stream = firstStream(j);
  const gotFrames = parseCount(stream.nb_frames);
  const rate = parseRate(stream.r_frame_rate ?? '0/0');
  const gotValue = rate ? (rate.den ? rate.num / rate.den : rate.num) : null;
  return {
    frames: gotFrames,
    fps: stream.r_frame_rate ?? null,
    ok:
      gotFrames === frames &&
      gotValue !== null &&
      Math.abs(gotValue - fpsValue) < 1e-6,
  };
}

async function probeRateFrames(ffprobe: string, file: string): Promise<string> {
  const { stdout } = await execFileAsync(
    ffprobe,
    [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate,nb_frames',
      '-of', 'csv=p=0', '--', file,
    ],
    { maxBuffer: 1 << 20 },
  );
  return stdout.trim();
}

export async function outputMatchesSource(
  tools: FfToolPaths,
  src: string,
  out: string,
): Promise<boolean> {
  try {
    const [srcRate, srcFrames] = (await probeRateFrames(tools.ffprobe, src)).split(',');
    const [outRate, outFrames] = (await probeRateFrames(tools.ffprobe, out)).split(',');
    return Number(outFrames) > 0 && srcRate === outRate && srcFrames === outFrames;
  } catch {
    return false;
  }
}
