import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  decodePacketSamples,
  scanBufferForGpsPairs,
  spreadSampleTimes,
} from './cammeta-decode.js';
import type { CamMetaPacket, CamMetaResult } from './cammeta-decode.js';
import { ffprobeJson } from './ffmpeg.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';

const execFileAsync = promisify(execFile);

const FFMPEG_MAX_BUFFER = 64 * 1024 * 1024;

async function findCamMetaIndex(
  tools: FfmpegToolPaths,
  videoPath: string,
): Promise<number | null> {
  let probe: Record<string, unknown>;
  try {
    probe = await ffprobeJson(tools, videoPath, [
      '-select_streams',
      'd',
      '-show_entries',
      'stream=index:stream_tags=handler_name',
      '-of',
      'json',
    ]);
  } catch (e) {
    throw new Error('ffprobe failed while probing the cam meta stream', { cause: e });
  }
  const streams = (probe['streams'] ?? []) as Array<{
    index: number;
    tags?: { handler_name?: string };
  }>;
  for (const stream of streams) {
    if (stream.tags && stream.tags.handler_name === 'CAM meta') return stream.index;
  }
  return null;
}

async function listCamMetaPackets(
  tools: FfmpegToolPaths,
  videoPath: string,
  streamIndex: number,
): Promise<CamMetaPacket[]> {
  let probe: Record<string, unknown>;
  try {
    probe = await ffprobeJson(tools, videoPath, [
      // NOTE: bare stream index - `d:N` would mean the N-th *data* stream.
      '-select_streams',
      String(streamIndex),
      '-show_entries',
      'packet=pts_time,size',
      '-of',
      'json',
    ]);
  } catch (e) {
    throw new Error('ffprobe failed while listing the cam meta packets', { cause: e });
  }
  return ((probe['packets'] ?? []) as Array<{
    pts_time: string;
    size: string;
  }>).map((packet) => ({
    tSec: Number.parseFloat(packet.pts_time),
    size: Number.parseInt(packet.size, 10),
  }));
}

async function dumpCamMetaStream(
  tools: FfmpegToolPaths,
  videoPath: string,
  streamIndex: number,
): Promise<Buffer> {
  const tmp = path.join(
    os.tmpdir(),
    `cammeta_${process.pid}_${Date.now().toString(36)}.bin`,
  );
  try {
    try {
      await execFileAsync(
        tools.ffmpeg,
        [
          '-v', 'error', '-y', '-i', videoPath,
          '-map', `0:${streamIndex}`, '-c', 'copy', '-f', 'rawvideo', tmp,
        ],
        { maxBuffer: FFMPEG_MAX_BUFFER },
      );
    } catch (e) {
      throw new Error('ffmpeg failed while dumping the cam meta stream', { cause: e });
    }
    return fs.readFileSync(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Resolves to null only when the video carries no CAM meta stream at all; a
// present stream that yields nothing decodable resolves to empty samples so
// callers can tell absence from a stream without GPS fix pairs.
export async function parseCamMeta(
  tools: FfmpegToolPaths,
  videoPath: string,
  durationSec: number,
  opts: { keepAll?: boolean } = {},
): Promise<CamMetaResult | null> {
  const streamIndex = await findCamMetaIndex(tools, videoPath);
  if (streamIndex === null) return null;

  const packets = await listCamMetaPackets(tools, videoPath, streamIndex);

  const buf = await dumpCamMetaStream(tools, videoPath, streamIndex);

  const sizeSum = packets.reduce(
    (sum, packet) => sum + (Number.isFinite(packet.size) ? packet.size : 0),
    0,
  );
  if (buf.length > 0 && packets.length > 0 && sizeSum === buf.length) {
    const { samples, noLock, provenance } = decodePacketSamples(buf, packets, opts.keepAll === true);
    return { samples, noLock, method: 'dvtm-packets', ...provenance };
  }

  const samples = scanBufferForGpsPairs(buf);
  spreadSampleTimes(samples, durationSec);
  return {
    samples,
    noLock: 0,
    method: 'cammeta-scan',
    protoFile: null,
    gimbalDevice: null,
  };
}
