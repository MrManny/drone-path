import { parseSrt } from './srt.js';
import type { SrtCue } from './srt.js';
import { parseCamMeta } from './cammeta.js';
import type { CamSample, GimbalDeviceConstants } from './cammeta.js';
import type { FfToolPaths } from './fftools.js';
import { findSrtSidecar } from './inputs.js';
import { buildTelemetry } from './telemetry-math.js';
import type { Telemetry, TelemetrySamples } from './telemetry-math.js';
import type { TelemetryFrameInput } from './telemetry-json.js';

export interface LoadedTelemetry {
  telemetry: Telemetry;
  /** One entry per source frame, index-aligned to the frames. */
  frameValues: TelemetryFrameInput[];
  /** "proto_file_name product_proto_version" as declared, null when absent. */
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

// The .SRT sidecar takes precedence over the embedded CAM-meta stream.
async function loadSamples(
  tools: FfToolPaths,
  videoPath: string,
  durationSec: number,
): Promise<SourceSamples> {
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

  // keepAll keeps fix-less packets so the export gets one row per source
  // frame; the pipeline still sees only fix-bearing samples, so the values
  // the overlay renders do not change.
  const cam = await parseCamMeta(tools, videoPath, durationSec, { keepAll: true });
  const fixSamples = cam ? cam.samples.filter((sample) => sample.fix !== null) : [];
  if (!cam || fixSamples.length === 0) {
    throw new Error(
      'no telemetry found: no .SRT sidecar and no GPS pairs in the CAM meta stream',
    );
  }
  return {
    samples: fixSamples,
    source: 'cammeta',
    method: cam.method,
    noLock: cam.noLock,
    // The byte-scan fallback has no frame alignment; its samples must not
    // masquerade as source frames.
    frameValues:
      cam.method === 'dvtm-packets' ? cam.samples.map(camSampleToFrameValues) : [],
    protoFile: cam.protoFile,
    gimbalDevice: cam.gimbalDevice,
  };
}

export async function loadTelemetry(
  videoPath: string,
  {
    frames,
    fpsValue,
    durationSec,
    tools,
  }: { frames: number; fpsValue: number; durationSec: number; tools: FfToolPaths },
): Promise<LoadedTelemetry> {
  const loaded = await loadSamples(tools, videoPath, durationSec);
  const { frameValues, protoFile, gimbalDevice, ...samples } = loaded;
  return {
    telemetry: buildTelemetry(samples, { frames, fpsValue }),
    frameValues,
    protoFile,
    gimbalDevice,
  };
}
