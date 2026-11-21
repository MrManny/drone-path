import { constants } from 'node:buffer';

import {
  decodePacketSamples,
  scanBufferForGpsPairs,
  spreadSampleTimes,
} from './cammeta-decode.js';
import type { CamMetaPacket, CamMetaResult } from './cammeta-decode.js';
import { runToolBinary } from './exec-tool.js';
import { ffprobeJson, findCamMetaStream } from './ffmpeg.js';
import type { CamMetaStream } from './ffmpeg.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';
import { readCamMetaTrack } from './mp4-cammeta.js';

async function probeCamMetaStream(
  tools: FfmpegToolPaths,
  videoPath: string,
  signal?: AbortSignal,
): Promise<CamMetaStream | null> {
  let probe: Record<string, unknown>;
  try {
    probe = await ffprobeJson(tools, videoPath, [
      '-select_streams',
      'd',
      '-show_entries',
      'stream=index,id:stream_tags=handler_name',
      '-of',
      'json',
    ], signal);
  } catch (e) {
    throw new Error('ffprobe failed while probing the cam meta stream', { cause: e });
  }
  return findCamMetaStream(probe);
}

async function listCamMetaPackets(
  tools: FfmpegToolPaths,
  videoPath: string,
  streamIndex: number,
  signal?: AbortSignal,
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
    ], signal);
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
  signal?: AbortSignal,
): Promise<Buffer> {
  try {
    return await runToolBinary(
      tools.ffmpeg,
      [
        '-v', 'error', '-i', videoPath,
        '-map', `0:${streamIndex}`, '-c', 'copy', '-f', 'rawvideo', 'pipe:1',
      ],
      { maxBuffer: constants.MAX_LENGTH, signal },
    );
  } catch (e) {
    throw new Error('ffmpeg failed while dumping the cam meta stream', { cause: e });
  }
}

// Resolves to null only when the video carries no CAM meta stream at all; a
// present stream that yields nothing decodable resolves to empty samples so
// callers can tell absence from a stream without GPS fix pairs.
export async function parseCamMeta(
  tools: FfmpegToolPaths,
  videoPath: string,
  durationSec: number,
  opts: { keepAll?: boolean; stream?: CamMetaStream | null; signal?: AbortSignal } = {},
): Promise<CamMetaResult | null> {
  opts.signal?.throwIfAborted();
  const stream = opts.stream === undefined ? await probeCamMetaStream(tools, videoPath, opts.signal) : opts.stream;
  if (stream === null) return null;

  const direct = stream.trackId === undefined ? null : await readCamMetaTrack(videoPath, stream.trackId, opts.signal);
  const packets = direct?.packets ?? await listCamMetaPackets(tools, videoPath, stream.index, opts.signal);
  const buf = direct?.buffer ?? await dumpCamMetaStream(tools, videoPath, stream.index, opts.signal);

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
