import { gpsFixOrNull } from './geo.js';
import type { LatLon } from './geo.js';
import {
  firstDoubleField,
  firstFloatField,
  firstStringField,
  firstVarintField,
  parseProtoFields,
  firstSubMessage,
} from './protobuf-wire.js';
import type { ProtoFieldMap } from './protobuf-wire.js';

export interface ProductMeta {
  fix: LatLon | null;
  noLock: boolean;
  relAlt: number | null;
  absAlt: number | null;
  yawDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  gpsAltMm: number | null;
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

export interface ClipProvenance {
  protoFile: string | null;
  gimbalDevice: GimbalDeviceConstants | null;
}

export interface CamMetaResult {
  samples: CamSample[];
  noLock: number;
  method: CamMetaMethod;
  protoFile: string | null;
  gimbalDevice: GimbalDeviceConstants | null;
}

// DVTM field numbers; the message layout is documented in docs/telemetry-protobuf.md.
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

// GPS double-pair wire signature (0x11 lat f64, 0x19 lon f64); see docs/telemetry-protobuf.md.
const GPS_PAIR_SPAN = 18;

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

export function decodeProductMeta(
  buf: Buffer,
  start = 0,
  end = buf.length,
): ProductMeta {
  const top = parseProtoFields(buf, start, end);
  const frameMeta = firstSubMessage(buf, top, FRAME_META);
  const camera = frameMeta ? firstSubMessage(buf, frameMeta, CAMERA) : null;
  const drone = frameMeta ? firstSubMessage(buf, frameMeta, DRONE) : null;
  const gimbal = frameMeta ? firstSubMessage(buf, frameMeta, GIMBAL) : null;
  const absAlt = camera ? decodeAbsoluteAltitude(buf, camera) : null;
  const gps = drone ? decodeGps(buf, drone) : null;
  const euler = drone ? decodeEulerAngles(buf, drone, EULER_ANGLE) : null;
  const gimbalEuler = gimbal
    ? decodeEulerAngles(buf, gimbal, GIMBAL_EULER_ANGLE)
    : null;
  const gimbalHeader = gimbal
    ? firstSubMessage(buf, gimbal, GIMBAL_DEVICE_HEADER)
    : null;
  return {
    fix: gps?.fix ?? null,
    noLock: gps?.noLock ?? false,
    relAlt: drone ? decodeRelativeAltitude(buf, drone) : null,
    absAlt: absAlt ?? gpsAltMeters(gps?.gpsAltMm ?? null),
    yawDeg: euler?.yawDeg ?? null,
    pitchDeg: euler?.pitchDeg ?? null,
    rollDeg: euler?.rollDeg ?? null,
    gpsAltMm: gps?.gpsAltMm ?? null,
    gimbalPitchDeg: gimbalEuler?.pitchDeg ?? null,
    gimbalRollDeg: gimbalEuler?.rollDeg ?? null,
    gimbalYawDeg: gimbalEuler?.yawDeg ?? null,
    gimbalDeviceTimestampMs: gimbalHeader
      ? (firstVarintField(gimbalHeader, DEVICE_TIMESTAMP) ?? 0)
      : null,
    iso: camera ? decodeCameraVarint(buf, camera, ISO) : null,
    whiteBalanceCctK: camera ? decodeCameraVarint(buf, camera, WHITE_BALANCE_CCT) : null,
  };
}

function decodeCameraVarint(
  buf: Buffer,
  camera: ProtoFieldMap,
  fieldNumber: number,
): number | null {
  const message = firstSubMessage(buf, camera, fieldNumber);
  return message ? (firstVarintField(message, VALUE) ?? 0) : null;
}

function decodeAbsoluteAltitude(
  buf: Buffer,
  camera: ProtoFieldMap,
): number | null {
  const absoluteAltitude = firstSubMessage(buf, camera, ABSOLUTE_ALTITUDE);
  if (!absoluteAltitude) return null;
  const meters = firstFloatField(absoluteAltitude, VALUE) ?? 0;
  return Number.isFinite(meters) ? meters : null;
}

interface GpsDecode {
  fix: LatLon | null;
  noLock: boolean;
  gpsAltMm: number | null;
}

function gpsAltMeters(gpsAltMm: number | null): number | null {
  return gpsAltMm !== null ? gpsAltMm / 1000 : null;
}

function decodeGps(buf: Buffer, drone: ProtoFieldMap): GpsDecode {
  const out: GpsDecode = { fix: null, noLock: false, gpsAltMm: null };
  const gps = firstSubMessage(buf, drone, GPS_BASIC);
  if (!gps) return out;

  const coord = firstSubMessage(buf, gps, POSITION_COORD);
  if (coord) {
    const lat = firstDoubleField(coord, LAT);
    const lon = firstDoubleField(coord, LON);
    if (lat !== null && lon !== null) {
      const fix = gpsFixOrNull(lat, lon);
      if (fix !== null) out.fix = fix;
      else out.noLock = true;
    }
  }
  out.gpsAltMm = firstVarintField(gps, GPS_ALTITUDE_MM) ?? 0;
  return out;
}

function decodeRelativeAltitude(
  buf: Buffer,
  drone: ProtoFieldMap,
): number | null {
  const relative = firstSubMessage(buf, drone, RELATIVE_ALTITUDE);
  if (!relative) return null;
  const millimeters = firstFloatField(relative, VALUE) ?? 0;
  return Number.isFinite(millimeters) ? millimeters / 1000 : null;
}

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
  const euler = firstSubMessage(buf, fields, fieldNumber);
  if (!euler) return null;
  return {
    pitchDeg: (firstVarintField(euler, PITCH) ?? 0) / 10,
    rollDeg: (firstVarintField(euler, ROLL) ?? 0) / 10,
    yawDeg: (firstVarintField(euler, YAW) ?? 0) / 10,
  };
}

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
  const clipMeta = firstSubMessage(buf, top, CLIP_META);
  const header = clipMeta && firstSubMessage(buf, clipMeta, CLIP_META_HEADER);
  if (!header) return null;
  const name = nonEmptyString(buf, header, PROTO_FILE_NAME);
  const version = nonEmptyString(buf, header, PRODUCT_PROTO_VERSION);
  if (!name) return null;
  return version ? `${name} ${version}` : name;
}

function nonEmptyString(
  buf: Buffer,
  fields: ProtoFieldMap,
  fieldNumber: number,
): string | null {
  const value = firstStringField(buf, fields, fieldNumber)?.trim() ?? '';
  return value === '' ? null : value;
}

function decodeGimbalDevice(
  buf: Buffer,
  top: ProtoFieldMap,
): GimbalDeviceConstants | null {
  const frameMeta = firstSubMessage(buf, top, FRAME_META);
  const gimbal = frameMeta && firstSubMessage(buf, frameMeta, GIMBAL);
  const header = gimbal && firstSubMessage(buf, gimbal, GIMBAL_DEVICE_HEADER);
  if (!header) return null;
  return {
    id: firstVarintField(header, DEVICE_ID) ?? 0,
    type: firstVarintField(header, DEVICE_TYPE) ?? 0,
    subType: firstVarintField(header, DEVICE_SUB_TYPE) ?? 0,
    name: firstStringField(buf, header, DEVICE_NAME) ?? '',
    frequency: firstFloatField(header, DEVICE_FREQUENCY) ?? 0,
  };
}

export function scanGpsPair(
  buf: Buffer,
  offset = 0,
  end = buf.length,
): { fix: LatLon; at: number } | null {
  for (let i = offset; i <= end - GPS_PAIR_SPAN; i++) {
    if (buf[i] === 0x11 && buf[i + 9] === 0x19) {
      const fix = gpsFixOrNull(buf.readDoubleLE(i + 1), buf.readDoubleLE(i + 10));
      if (fix !== null) return { fix, at: i };
    }
  }
  return null;
}

export interface CamMetaPacket {
  tSec: number;
  size: number;
}

function toCamSample(meta: ProductMeta, tSec: number): CamSample {
  return { tSec, ...meta };
}

export function decodePacketSamples(
  buf: Buffer,
  packets: CamMetaPacket[],
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
      const tSec = Number.isFinite(packet.tSec) ? packet.tSec : 0;
      samples.push(toCamSample(meta, tSec));
    }
    offset = end;
  }
  return { samples, noLock, provenance: { protoFile, gimbalDevice } };
}

export function scanBufferForGpsPairs(buf: Buffer): CamSample[] {
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

export function spreadSampleTimes(samples: CamSample[], durationSec: number): void {
  const span =
    Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : samples.length;
  samples.forEach((sample, k) => {
    sample.tSec = (k / Math.max(1, samples.length - 1)) * span;
  });
}
