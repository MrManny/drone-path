// Format (reverse-engineered and verified value-by-value against .SRT data):
//   * the MP4 carries a `data` stream, sample-entry fourcc `djmd`, handler
//     "CAM meta"; its payload is DJI's internal "DVTM" (DJI Video Metadata)
//     protobuf: one ProductMeta message per MP4 sample = one video frame.
//     Messages are VARIABLE length (e.g. 299-563 B on DJI Neo 2) - never
//     assume a fixed stride; split the raw dump by ffprobe packet sizes so
//     each message aligns to its packet PTS (= frame time).
//   * ProductMeta { 1 clip_meta, 2 stream_meta, 3 frame_meta } (clip/stream
//     meta appear only in the first sample); clip_meta { 1 clip_meta_header
//     { 1 proto_file_name, 3 product_proto_version } } names the schema.
//   * frame_meta { 1 header, 2 camera, 3 imu (absent on Neo 2), 4 drone,
//     5 gimbal }:
//       - camera.3   ISO { 1 varint } (SRT `iso`)
//       - camera.6   WhiteBalanceCCT { 1 varint } (SRT `ct`)
//       - camera.11 AbsoluteAltitude { 1 float32 meters MSL }
//       - drone.3   EulerAngle { 1 pitch, 2 roll, 3 yaw } varint deci-degrees
//                   (yaw = drone heading, valid even while hovering)
//       - drone.4   GpsBasic { 1 PositionCoord { 2 lat, 3 lon } doubles WGS84,
//                             2 gps_altitude_mm varint }
//       - drone.5   RelativeAltitude { 1 float32 millimeters above takeoff }
//       - gimbal.1  MetaHeaderOfDevice { 1 device_id, 2 device_type,
//                   3 device_sub_type, 4 device_name, 5 device_frequency,
//                   6 device_timestamp } (constants + per-frame timestamp)
//       - gimbal.2  EulerAngle { 1 pitch, 2 roll, 3 yaw } = stabilized camera
//                   attitude, same encoding as drone.3
//   * No epoch timestamp in-stream (frame_timestamp is microseconds since
//     power-up); sample index == frame index.
//   * Schemas: recovered DJI .proto files in AdrianEddy/telemetry-parser
//     (MIT/Apache-2.0, dvtm_library.proto / dvtm_eagle4_wa530.proto);
//     there is no official DJI spec and no public dvtm_NEO2.proto, but the
//     Neo 2 layout matches those schemas.
//
// Robustness: a per-packet protobuf walk is the primary path; a whole-buffer
// byte scan of the GPS double pair (tag 0x11 lat / 0x19 lon) is the fallback
// for firmware layouts we do not understand.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { ffprobeJson } from './ff.js';
import type { FfToolPaths } from './fftools.js';
import { gpsFix } from './geo.js';
import type { LatLon } from './geo.js';
import {
  firstDouble,
  firstFloat,
  firstString,
  firstVarint,
  parseProtoFields,
  subMessage,
} from './proto.js';
import type { ProtoFieldMap } from './proto.js';

const execFileAsync = promisify(execFile);

export interface ProductMeta {
  /** A real GPS fix, or null when the frame has none (see gpsFix). */
  fix: LatLon | null;
  /** Position pair present but not a real fix (see isGpsFix). */
  noLock: boolean;
  relAlt: number | null;
  absAlt: number | null;
  yawDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  /** Raw gps_altitude_mm (GpsBasic.2). */
  gpsAltMm: number | null;
  /** Stabilized camera attitude (gimbal.2); null = no gimbal attitude. */
  gimbalPitchDeg: number | null;
  gimbalRollDeg: number | null;
  gimbalYawDeg: number | null;
  gimbalDeviceTimestampMs: number | null;
  iso: number | null;
  whiteBalanceCctK: number | null;
}

export interface CamSample extends ProductMeta {
  tSec: number;
}

export type CamMetaMethod = 'dvtm-packets' | 'cammeta-scan';

export interface GimbalDeviceConstants {
  id: number;
  type: number;
  subType: number;
  name: string;
  frequency: number;
}

/** The clip-level constants a ProductMeta can declare. */
export interface ClipProvenance {
  /** "proto_file_name product_proto_version" as declared, null when absent. */
  protoFile: string | null;
  gimbalDevice: GimbalDeviceConstants | null;
}

export interface CamMetaResult {
  samples: CamSample[];
  /** No-lock positions; the byte-scan fallback reports 0 (fix pairs only). */
  noLock: number;
  method: CamMetaMethod;
  protoFile: string | null;
  gimbalDevice: GimbalDeviceConstants | null;
}

// DVTM field numbers (see the module comment for the message layout).
const CLIP_META = 1;
const CLIP_META_HEADER = 1;
const PROTO_FILE_NAME = 1;
const PRODUCT_PROTO_VERSION = 3;
const FRAME_META = 3;
const CAMERA = 2;
const ISO = 3;
const WHITE_BALANCE_CCT = 6;
const ABSOLUTE_ALTITUDE = 11;
const DRONE = 4;
const GPS_BASIC = 4;
const POSITION_COORD = 1;
const GPS_ALTITUDE_MM = 2;
const RELATIVE_ALTITUDE = 5;
const EULER_ANGLE = 3;
const GIMBAL = 5;
const GIMBAL_DEVICE_HEADER = 1;
const GIMBAL_EULER_ANGLE = 2;
const DEVICE_ID = 1;
const DEVICE_TYPE = 2;
const DEVICE_SUB_TYPE = 3;
const DEVICE_NAME = 4;
const DEVICE_FREQUENCY = 5;
const DEVICE_TIMESTAMP = 6;
const VALUE = 1;
const PITCH = 1;
const ROLL = 2;
const YAW = 3;
const LAT = 2;
const LON = 3;

// Size of the 0x11/0x19 fixed64 GPS double pair scanned by the fallback.
const GPS_PAIR_SPAN = 18;

const FFMPEG_MAX_BUFFER = 64 * 1024 * 1024;

function emptyProductMeta(): ProductMeta {
  return {
    fix: null,
    noLock: false,
    relAlt: null,
    absAlt: null,
    yawDeg: null,
    pitchDeg: null,
    rollDeg: null,
    gpsAltMm: null,
    gimbalPitchDeg: null,
    gimbalRollDeg: null,
    gimbalYawDeg: null,
    gimbalDeviceTimestampMs: null,
    iso: null,
    whiteBalanceCctK: null,
  };
}

async function findCamMetaIndex(
  tools: FfToolPaths,
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

export function decodeProductMeta(
  buf: Buffer,
  start = 0,
  end = buf.length,
): ProductMeta {
  const top = parseProtoFields(buf, start, end);
  const frameMeta = subMessage(buf, top, FRAME_META);
  const camera = frameMeta ? subMessage(buf, frameMeta, CAMERA) : null;
  const drone = frameMeta ? subMessage(buf, frameMeta, DRONE) : null;
  const gimbal = frameMeta ? subMessage(buf, frameMeta, GIMBAL) : null;
  const absAlt = camera ? decodeAbsoluteAltitude(buf, camera) : null;
  const gps = drone ? decodeGps(buf, drone) : null;
  const euler = drone ? decodeEulerAngles(buf, drone, EULER_ANGLE) : null;
  const gimbalEuler = gimbal
    ? decodeEulerAngles(buf, gimbal, GIMBAL_EULER_ANGLE)
    : null;
  const gimbalHeader = gimbal
    ? subMessage(buf, gimbal, GIMBAL_DEVICE_HEADER)
    : null;
  return {
    fix: gps?.fix ?? null,
    noLock: gps?.noLock ?? false,
    relAlt: drone ? decodeRelativeAltitude(buf, drone) : null,
    // camera.11 is authoritative; gps_altitude_mm is its fallback.
    absAlt: absAlt ?? gpsAltMeters(gps?.gpsAltMm ?? null),
    yawDeg: euler?.yawDeg ?? null,
    pitchDeg: euler?.pitchDeg ?? null,
    rollDeg: euler?.rollDeg ?? null,
    gpsAltMm: gps?.gpsAltMm ?? null,
    gimbalPitchDeg: gimbalEuler?.pitchDeg ?? null,
    gimbalRollDeg: gimbalEuler?.rollDeg ?? null,
    gimbalYawDeg: gimbalEuler?.yawDeg ?? null,
    gimbalDeviceTimestampMs: gimbalHeader
      ? firstVarint(gimbalHeader, DEVICE_TIMESTAMP)
      : null,
    iso: camera ? decodeCameraVarint(buf, camera, ISO) : null,
    whiteBalanceCctK: camera ? decodeCameraVarint(buf, camera, WHITE_BALANCE_CCT) : null,
  };
}

// camera.3 ISO { 1 varint } and camera.6 WhiteBalanceCCT { 1 varint }.
function decodeCameraVarint(
  buf: Buffer,
  camera: ProtoFieldMap,
  fieldNumber: number,
): number | null {
  const message = subMessage(buf, camera, fieldNumber);
  return message ? firstVarint(message, VALUE) : null;
}

// camera.11 AbsoluteAltitude { 1 float32 meters MSL }.
function decodeAbsoluteAltitude(
  buf: Buffer,
  camera: ProtoFieldMap,
): number | null {
  const absoluteAltitude = subMessage(buf, camera, ABSOLUTE_ALTITUDE);
  return absoluteAltitude ? firstFloat(absoluteAltitude, VALUE) : null;
}

// drone.4 GpsBasic: WGS84 lat/lon doubles plus gps_altitude_mm (the
// absolute-altitude fallback when camera.11 is missing). A position pair
// that fails gpsFix is the no-lock placeholder: counted, never a fix.
interface GpsDecode {
  fix: LatLon | null;
  /** Position pair present but not a real fix (see isGpsFix). */
  noLock: boolean;
  /** gps_altitude_mm as decoded (raw millimeters). */
  gpsAltMm: number | null;
}

function gpsAltMeters(gpsAltMm: number | null): number | null {
  return gpsAltMm !== null ? gpsAltMm / 1000 : null;
}

function decodeGps(buf: Buffer, drone: ProtoFieldMap): GpsDecode {
  const out: GpsDecode = { fix: null, noLock: false, gpsAltMm: null };
  const gps = subMessage(buf, drone, GPS_BASIC);
  if (!gps) return out;

  const coord = subMessage(buf, gps, POSITION_COORD);
  if (coord) {
    const lat = firstDouble(coord, LAT);
    const lon = firstDouble(coord, LON);
    // Only a present pair is an event: a fix, or exactly one no-lock count.
    if (lat !== null && lon !== null) {
      const fix = gpsFix(lat, lon);
      if (fix !== null) out.fix = fix;
      else out.noLock = true;
    }
  }
  out.gpsAltMm = firstVarint(gps, GPS_ALTITUDE_MM);
  return out;
}

// drone.5 RelativeAltitude { 1 float32 millimeters above takeoff }.
function decodeRelativeAltitude(
  buf: Buffer,
  drone: ProtoFieldMap,
): number | null {
  const relative = subMessage(buf, drone, RELATIVE_ALTITUDE);
  const millimeters = relative ? firstFloat(relative, VALUE) : null;
  return millimeters !== null && Number.isFinite(millimeters)
    ? millimeters / 1000
    : null;
}

// drone.3 / gimbal.2 EulerAngle { 1 pitch, 2 roll, 3 yaw } varint
// deci-degrees. proto3 zero-omission: a present message with a wire-missing
// member carries the known default 0.0; only an absent message means "no
// attitude here".
interface EulerDecode {
  pitchDeg: number;
  rollDeg: number;
  yawDeg: number;
}

function decodeEulerAngles(
  buf: Buffer,
  fields: ProtoFieldMap,
  fieldNumber: number,
): EulerDecode | null {
  const euler = subMessage(buf, fields, fieldNumber);
  if (!euler) return null;
  return {
    pitchDeg: (firstVarint(euler, PITCH) ?? 0) / 10,
    rollDeg: (firstVarint(euler, ROLL) ?? 0) / 10,
    yawDeg: (firstVarint(euler, YAW) ?? 0) / 10,
  };
}

// The clip-level constants one ProductMeta can declare: the schema the clip
// header names and the gimbal device header. Anything not fully declared is
// reported absent - never guessed.
export function decodeProvenance(
  buf: Buffer,
  start = 0,
  end = buf.length,
): ClipProvenance {
  const top = parseProtoFields(buf, start, end);
  return {
    protoFile: decodeProtoFile(buf, top),
    gimbalDevice: decodeGimbalDevice(buf, top),
  };
}

function decodeProtoFile(buf: Buffer, top: ProtoFieldMap): string | null {
  const clipMeta = subMessage(buf, top, CLIP_META);
  const header = clipMeta && subMessage(buf, clipMeta, CLIP_META_HEADER);
  if (!header) return null;
  const name = nonEmptyString(buf, header, PROTO_FILE_NAME);
  const version = nonEmptyString(buf, header, PRODUCT_PROTO_VERSION);
  if (!name) return null;
  return version ? `${name} ${version}` : name;
}

// proto3 zero-omission: an empty string is the default, not a declaration.
function nonEmptyString(
  buf: Buffer,
  fields: ProtoFieldMap,
  fieldNumber: number,
): string | null {
  const value = firstString(buf, fields, fieldNumber)?.trim() ?? '';
  return value === '' ? null : value;
}

function decodeGimbalDevice(
  buf: Buffer,
  top: ProtoFieldMap,
): GimbalDeviceConstants | null {
  const frameMeta = subMessage(buf, top, FRAME_META);
  const gimbal = frameMeta && subMessage(buf, frameMeta, GIMBAL);
  const header = gimbal && subMessage(buf, gimbal, GIMBAL_DEVICE_HEADER);
  if (!header) return null;
  const id = firstVarint(header, DEVICE_ID);
  const type = firstVarint(header, DEVICE_TYPE);
  const subType = firstVarint(header, DEVICE_SUB_TYPE);
  const name = nonEmptyString(buf, header, DEVICE_NAME);
  const frequency = firstFloat(header, DEVICE_FREQUENCY);
  if (
    id === null ||
    type === null ||
    subType === null ||
    name === null ||
    frequency === null
  ) {
    return null;
  }
  return { id, type, subType, name, frequency };
}

// Byte-scan fallback: the 0x11/0x19 fixed64 GPS double pair. It judges
// coordinates through src/geo.ts's gpsFix - the same rule as the protobuf
// path, so a genuine fix is never accepted by one path and dropped by the
// other.
export function scanGpsPair(
  buf: Buffer,
  offset = 0,
  end = buf.length,
): { fix: LatLon; at: number } | null {
  for (let i = offset; i <= end - GPS_PAIR_SPAN; i++) {
    if (buf[i] === 0x11 && buf[i + 9] === 0x19) {
      const fix = gpsFix(buf.readDoubleLE(i + 1), buf.readDoubleLE(i + 10));
      if (fix !== null) return { fix, at: i };
    }
  }
  return null;
}

export interface PacketInfo {
  tSec: number;
  size: number;
}

// A probe failure is operational, not absence: it surfaces with its cause so
// a missing or broken ffprobe is never mistaken for a stream without data.
async function listCamMetaPackets(
  tools: FfToolPaths,
  videoPath: string,
  streamIndex: number,
): Promise<PacketInfo[]> {
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
  tools: FfToolPaths,
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

function toCamSample(meta: ProductMeta, tSec: number): CamSample {
  return { tSec, ...meta };
}

// Primary path: walk the dump packet by packet so each ProductMeta message
// aligns to its packet PTS. No-lock packets are counted like SRT counts
// no-lock cues so summaries agree across telemetry sources; they join the
// samples only under keepAll. Clip-level constants (first declaration wins)
// ride along for the telemetry JSON export header.
export function decodePacketSamples(
  buf: Buffer,
  packets: PacketInfo[],
  keepAll: boolean,
): { samples: CamSample[]; noLock: number; provenance: ClipProvenance } {
  const samples: CamSample[] = [];
  let noLock = 0;
  let offset = 0;
  let protoFile: string | null = null;
  let gimbalDevice: GimbalDeviceConstants | null = null;
  for (const packet of packets) {
    const end = offset + packet.size;
    if (protoFile === null || gimbalDevice === null) {
      const declared = decodeProvenance(buf, offset, end);
      protoFile ??= declared.protoFile;
      gimbalDevice ??= declared.gimbalDevice;
    }
    let meta = decodeProductMeta(buf, offset, end);
    if (meta.fix === null) {
      const hit = scanGpsPair(buf, offset, end);
      if (hit) meta = { ...meta, fix: hit.fix, noLock: false };
    }
    if (meta.noLock) noLock++;
    if (meta.fix !== null || keepAll) {
      // No PTS: pretend "same time as the first sample" rather than
      // fabricating a timeline out of a sample count (unit mismatch).
      const tSec = Number.isFinite(packet.tSec) ? packet.tSec : 0;
      samples.push(toCamSample(meta, tSec));
    }
    offset = end;
  }
  return { samples, noLock, provenance: { protoFile, gimbalDevice } };
}

// Fallback path: no frame alignment.
function scanBufferForGpsPairs(buf: Buffer): CamSample[] {
  const samples: CamSample[] = [];
  for (let i = 0; i <= buf.length - GPS_PAIR_SPAN; i++) {
    const hit = scanGpsPair(buf, i, i + GPS_PAIR_SPAN);
    if (hit) {
      const meta = emptyProductMeta();
      meta.fix = hit.fix;
      samples.push(toCamSample(meta, 0));
      i += GPS_PAIR_SPAN - 1;
    }
  }
  return samples;
}

// Best effort: scan-found samples carry no real timestamps.
function spreadSampleTimes(samples: CamSample[], durationSec: number): void {
  const span =
    Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : samples.length;
  samples.forEach((sample, k) => {
    sample.tSec = (k / Math.max(1, samples.length - 1)) * span;
  });
}

// opts.keepAll keeps every per-frame message even without a GPS fix (frame
// index then stays aligned to video frames; lat stays null). Default false
// keeps only GPS-bearing frames.
export async function parseCamMeta(
  tools: FfToolPaths,
  videoPath: string,
  durationSec: number,
  opts: { keepAll?: boolean } = {},
): Promise<CamMetaResult | null> {
  const keepAll = opts.keepAll === true;
  // Null returns below mark a genuine absence ("no CAM meta stream"); tool
  // failures have already thrown with their cause by this point.
  const streamIndex = await findCamMetaIndex(tools, videoPath);
  if (streamIndex === null) return null;

  const packets = await listCamMetaPackets(tools, videoPath, streamIndex);

  const buf = await dumpCamMetaStream(tools, videoPath, streamIndex);
  if (buf.length === 0) return null;

  const sizeSum = packets.reduce(
    (sum, packet) => sum + (Number.isFinite(packet.size) ? packet.size : 0),
    0,
  );
  if (packets.length > 0 && sizeSum === buf.length) {
    const { samples, noLock, provenance } = decodePacketSamples(buf, packets, keepAll);
    return { samples, noLock, method: 'dvtm-packets', ...provenance };
  }

  const samples = scanBufferForGpsPairs(buf);
  if (samples.length === 0) return null;
  spreadSampleTimes(samples, durationSec);
  // The scan sees complete fix pairs only - a no-lock placeholder is
  // indistinguishable from absent bytes in raw data.
  return {
    samples,
    noLock: 0,
    method: 'cammeta-scan',
    protoFile: null,
    gimbalDevice: null,
  };
}
