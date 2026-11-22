import { ERR_NO_TELEMETRY, codedError } from './errors.js';
import { parseSrt } from './srt.js';
import type { SrtCue } from './srt.js';
import { findSrtSidecar } from './srt-sidecar.js';
import { parseCamMeta } from './cammeta.js';
import type { CamSample, GimbalDeviceConstants } from './cammeta-decode.js';
import type { CamMetaStream } from './ffmpeg.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';
import { computeTelemetry } from './telemetry-math.js';
import type { Telemetry, TelemetrySamples } from './telemetry-math.js';
import type { TelemetryFrameInput } from './telemetry-json.js';
import type { TrackRecord } from './track.js';

export interface RecordingTelemetry {
  telemetry: Telemetry;
  frameValues: TelemetryFrameInput[];
  // Fix-faithful records for the track exports, each with its source time,
  // including the cammeta-scan method whose samples never reach the telemetry
  // JSON document.
  trackValues: TrackRecord[];
  protoFile: string | null;
  gimbalDevice: GimbalDeviceConstants | null;
}

function srtCueToFrameValues(cue: SrtCue): TelemetryFrameInput {
  return {
    lat: cue.fix?.lat ?? null,
    lng: cue.fix?.lon ?? null,
    altAbs: cue.absAlt,
    altRel: cue.relAlt,
    iso: cue.iso,
    shutterTime: cue.shutterTime,
    whiteBalanceCctK: cue.whiteBalanceCctK,
    fNumber: cue.fNumber,
  };
}

function camSampleToFrameValues(sample: CamSample): TelemetryFrameInput {
  return {
    gimbalDeviceTimestampMs: sample.gimbalDeviceTimestampMs,
    lat: sample.fix?.lat ?? null,
    lng: sample.fix?.lon ?? null,
    altAbs: sample.absAlt,
    altRel: sample.relAlt,
    gpsAltMm: sample.gpsAltMm,
    pitchDeg: sample.pitchDeg,
    rollDeg: sample.rollDeg,
    yawDeg: sample.yawDeg,
    gimbalPitchDeg: sample.gimbalPitchDeg,
    gimbalRollDeg: sample.gimbalRollDeg,
    gimbalYawDeg: sample.gimbalYawDeg,
    iso: sample.iso,
    whiteBalanceCctK: sample.whiteBalanceCctK,
  };
}

function toTrackRecords<T extends { tSec: number }>(
  items: readonly T[],
  toValues: (item: T) => TelemetryFrameInput,
): TrackRecord[] {
  return items.map((item) => ({ ...toValues(item), tSec: item.tSec }));
}

export interface SourceSamples extends TelemetrySamples {
  frameValues: TelemetryFrameInput[];
  trackValues: TrackRecord[];
  protoFile: string | null;
  gimbalDevice: GimbalDeviceConstants | null;
}

export async function loadTelemetrySamples(
  tools: FfmpegToolPaths,
  videoPath: string,
  durationSec: number,
  camMeta?: CamMetaStream | null,
  signal?: AbortSignal,
  sidecar?: string | null,
): Promise<SourceSamples | null> {
  const cam = await parseCamMeta(tools, videoPath, durationSec, { keepAll: true, stream: camMeta, signal });
  if (cam) {
    const fixSamples = cam.samples.filter((sample) => sample.fix !== null);
    return {
      samples: fixSamples,
      source: 'cammeta',
      method: cam.method,
      noLock: cam.noLock,
      frameValues:
        cam.method === 'dvtm-packets' ? cam.samples.map(camSampleToFrameValues) : [],
      trackValues: toTrackRecords(cam.samples, camSampleToFrameValues),
      protoFile: cam.protoFile,
      gimbalDevice: cam.gimbalDevice,
    };
  }

  const srtPath = sidecar === undefined ? findSrtSidecar(videoPath) : sidecar;
  if (srtPath) {
    const parsed = await parseSrt(srtPath, signal);
    if (parsed.count === 0) throw new Error(`SRT sidecar has no cues: ${srtPath}`);
    return {
      samples: parsed.cues.map((cue) => ({
        tSec: cue.tSec,
        fix: cue.fix,
        relAlt: cue.relAlt,
        absAlt: cue.absAlt,
        yawDeg: null,
      })),
      source: 'srt',
      method: 'srt-cues',
      noLock: parsed.noLock,
      frameValues: parsed.cues.map(srtCueToFrameValues),
      trackValues: toTrackRecords(parsed.cues, srtCueToFrameValues),
      protoFile: null,
      gimbalDevice: null,
    };
  }

  return null;
}

export async function loadTelemetry(
  videoPath: string,
  {
    frames,
    fpsValue,
    durationSec,
    tools,
    camMeta,
  }: {
    frames: number;
    fpsValue: number;
    durationSec: number;
    tools: FfmpegToolPaths;
    camMeta?: CamMetaStream | null;
  },
): Promise<RecordingTelemetry> {
  const loaded = await loadTelemetrySamples(tools, videoPath, durationSec, camMeta);
  if (!loaded) {
    throw codedError(`${ERR_NO_TELEMETRY}no CAM meta (DVTM) stream and no .SRT sidecar`, {
      code: 'NO_TELEMETRY',
    });
  }
  if (loaded.source === 'cammeta' && loaded.samples.length === 0) {
    throw codedError(
      `${ERR_NO_TELEMETRY}the CAM meta (DVTM) stream has no GPS fix pairs; ` +
        'the .SRT sidecar is only consulted when no CAM meta stream is present',
      { code: 'NO_TELEMETRY' },
    );
  }
  const { frameValues, trackValues, protoFile, gimbalDevice, ...samples } = loaded;
  return {
    telemetry: computeTelemetry(samples, { frames, fpsValue }),
    frameValues,
    trackValues,
    protoFile,
    gimbalDevice,
  };
}
