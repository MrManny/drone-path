import { runTool } from 'drone-path-core/exec-tool';
import { ffprobeJson, firstVideoStream } from 'drone-path-core/ffmpeg';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import { parseRate } from 'drone-path-core/frametime';

interface OutputVerifyResult {
  frames: number;
  fps: string | null;
  ok: boolean;
}

const RATE_PROBE_MAX_BUFFER = 1 << 20;

export async function verifyOutput(
  tools: FfmpegToolPaths,
  outPath: string,
  frames: number,
  fpsValue: number,
): Promise<OutputVerifyResult> {
  const j = await ffprobeJson(tools, outPath, [
    '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_frames,r_frame_rate',
    '-of', 'json',
  ]);
  const stream = firstVideoStream(j);
  const gotFrames = Number.parseInt(stream.nb_frames ?? '', 10);
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
  const { stdout } = await runTool(
    ffprobe,
    [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate,nb_frames',
      '-of', 'csv=p=0', '--', file,
    ],
    { maxBuffer: RATE_PROBE_MAX_BUFFER },
  );
  return stdout.trim();
}

export async function outputMatchesSource(
  tools: FfmpegToolPaths,
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
