import { ERR_NO_TELEMETRY } from './errors.js';
import { parseSrt } from './srt.js';
import type { SrtCue } from './srt.js';
import { parseCamMeta } from './cammeta.js';
import type { CamSample, GimbalDeviceConstants } from './cammeta.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';
import { findSrtSidecar } from './recordings.js';
import { computeTelemetry } from './telemetry-math.js';
import type { Telemetry, TelemetrySamples } from './telemetry-math.js';
import type { TelemetryFrameInput } from './telemetry-json.js';

export interface RecordingTelemetry {
  telemetry: Telemetry;
  frameValues: TelemetryFrameInput[];
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

interface SourceSamples extends TelemetrySamples {
  frameValues: TelemetryFrameInput[];
  protoFile: string | null;
  gimbalDevice: GimbalDeviceConstants | null;
}

async function loadSamples(
  tools: FfmpegToolPaths,
  videoPath: string,
  durationSec: number,
): Promise<SourceSamples> {
  const cam = await parseCamMeta(tools, videoPath, durationSec, { keepAll: true });
  if (cam) {
    const fixSamples = cam.samples.filter((sample) => sample.fix !== null);
    if (fixSamples.length === 0) {
      throw new Error(
        `${ERR_NO_TELEMETRY}the CAM meta (DVTM) stream has no GPS fix pairs; ` +
          'the .SRT sidecar is only consulted when no CAM meta stream is present',
      );
    }
    return {
      samples: fixSamples,
      source: 'cammeta',
      method: cam.method,
      noLock: cam.noLock,
      frameValues:
        cam.method === 'dvtm-packets' ? cam.samples.map(camSampleToFrameValues) : [],
      protoFile: cam.protoFile,
      gimbalDevice: cam.gimbalDevice,
    };
  }

  const srtPath = findSrtSidecar(videoPath);
  if (srtPath) {
    const parsed = await parseSrt(srtPath);
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
      protoFile: null,
      gimbalDevice: null,
    };
  }

  throw new Error(
    `${ERR_NO_TELEMETRY}no CAM meta (DVTM) stream and no .SRT sidecar`,
  );
}

export async function loadTelemetry(
  videoPath: string,
  {
    frames,
    fpsValue,
    durationSec,
    tools,
  }: { frames: number; fpsValue: number; durationSec: number; tools: FfmpegToolPaths },
): Promise<RecordingTelemetry> {
  const loaded = await loadSamples(tools, videoPath, durationSec);
  const { frameValues, protoFile, gimbalDevice, ...samples } = loaded;
  return {
    telemetry: computeTelemetry(samples, { frames, fpsValue }),
    frameValues,
    protoFile,
    gimbalDevice,
  };
}
