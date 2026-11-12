import { describe, expect, it } from 'vitest';

import {
  decodePacketSamples,
  decodeProductMeta,
  decodeProvenance,
  scanGpsPair,
} from '../src/cammeta-decode.js';
import type { CamMetaPacket } from '../src/cammeta-decode.js';

function dbl(value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(value);
  return b;
}

function varint(value: number | bigint): Buffer {
  let v = BigInt.asUintN(64, BigInt(value));
  const bytes: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    bytes.push(b);
  } while (v > 0n);
  return Buffer.from(bytes);
}

function tag(num: number, wire: number): Buffer {
  return varint((num << 3) | wire);
}

function fldVarint(num: number, value: number | bigint): Buffer {
  return Buffer.concat([tag(num, 0), varint(value)]);
}

function fldDouble(num: number, value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(value);
  return Buffer.concat([tag(num, 1), b]);
}

function fldFloat(num: number, value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeFloatLE(value);
  return Buffer.concat([tag(num, 5), b]);
}

function fldBytes(num: number, payload: Buffer): Buffer {
  return Buffer.concat([tag(num, 2), varint(payload.length), payload]);
}

interface EulerSpec {
  pitch?: number;
  roll?: number;
  yaw?: number;
}

interface Meta {
  lat: number;
  lon: number;
  relAltMm: number;
  absAltM?: number;
  attitude?: EulerSpec;
  gpsAltMm?: number;
  iso?: number;
  ct?: number;
  gimbal?: EulerSpec & {
    device?: {
      id: number;
      type: number;
      subType: number;
      name: string;
      frequency: number;
      timestampMs?: number;
    };
  };
  clip?: { protoFile: string; productProtoVersion: string };
}

function eulerMessage(spec: EulerSpec): Buffer {
  const parts: Buffer[] = [];
  if (spec.pitch) parts.push(fldVarint(1, spec.pitch));
  if (spec.roll) parts.push(fldVarint(2, spec.roll));
  if (spec.yaw) parts.push(fldVarint(3, spec.yaw));
  return Buffer.concat(parts);
}

function buildProductMeta(m: Meta): Buffer {
  const coord = Buffer.concat([fldDouble(2, m.lat), fldDouble(3, m.lon)]);
  const gpsParts = [fldBytes(1, coord)];
  if (m.gpsAltMm) gpsParts.push(fldVarint(2, m.gpsAltMm));
  const gps = fldBytes(4, Buffer.concat(gpsParts));
  const rel = fldBytes(5, m.relAltMm ? fldFloat(1, m.relAltMm) : Buffer.alloc(0));

  const droneParts = [gps, rel];
  if (m.attitude) droneParts.unshift(fldBytes(3, eulerMessage(m.attitude)));
  const drone = fldBytes(4, Buffer.concat(droneParts));

  const camParts: Buffer[] = [];
  if (m.iso !== undefined) {
    camParts.push(fldBytes(3, m.iso ? fldVarint(1, m.iso) : Buffer.alloc(0)));
  }
  if (m.ct !== undefined) {
    camParts.push(fldBytes(6, m.ct ? fldVarint(1, m.ct) : Buffer.alloc(0)));
  }
  if (m.absAltM !== undefined) {
    camParts.push(fldBytes(11, m.absAltM ? fldFloat(1, m.absAltM) : Buffer.alloc(0)));
  }

  const frameParts = camParts.length > 0 ? [fldBytes(2, Buffer.concat(camParts))] : [];
  frameParts.push(drone);
  if (m.gimbal) {
    const gimbalParts: Buffer[] = [];
    const device = m.gimbal.device;
    if (device) {
      const headerParts: Buffer[] = [];
      if (device.id) headerParts.push(fldVarint(1, device.id));
      if (device.type) headerParts.push(fldVarint(2, device.type));
      if (device.subType) headerParts.push(fldVarint(3, device.subType));
      if (device.name) headerParts.push(fldBytes(4, Buffer.from(device.name, 'utf8')));
      if (device.frequency) headerParts.push(fldFloat(5, device.frequency));
      if (device.timestampMs) headerParts.push(fldVarint(6, device.timestampMs));
      gimbalParts.push(fldBytes(1, Buffer.concat(headerParts)));
    }
    gimbalParts.push(fldBytes(2, eulerMessage(m.gimbal)));
    frameParts.push(fldBytes(5, Buffer.concat(gimbalParts)));
  }

  const parts: Buffer[] = [];
  if (m.clip) {
    const clipHeader = Buffer.concat([
      fldBytes(1, Buffer.from(m.clip.protoFile, 'utf8')),
      fldBytes(3, Buffer.from(m.clip.productProtoVersion, 'utf8')),
    ]);
    parts.push(fldBytes(1, fldBytes(1, clipHeader)));
  }
  parts.push(fldBytes(3, Buffer.concat(frameParts)));
  return Buffer.concat(parts);
}

const GIMBAL_DEVICE = {
  id: 0,
  type: 1,
  subType: 3,
  name: 'gimbal',
  frequency: 200,
  timestampMs: 1234,
};

describe('decodeProductMeta', () => {
  it('decodes GPS, altitudes and Euler angles from a synthetic message', () => {
    const buf = buildProductMeta({
      lat: 46.61307,
      lon: 14.262388,
      relAltMm: 3300,
      absAltM: 313.227,
      attitude: { pitch: 123, roll: 456, yaw: 2700 },
      gpsAltMm: 313227,
    });
    const m = decodeProductMeta(buf);
    expect(m.fix?.lat).toBeCloseTo(46.61307, 9);
    expect(m.fix?.lon).toBeCloseTo(14.262388, 9);
    expect(m.relAlt).toBeCloseTo(3.3, 4);
    expect(m.absAlt).toBeCloseTo(313.227, 2); // float32 precision
    expect(m.pitchDeg).toBeCloseTo(12.3, 6);
    expect(m.rollDeg).toBeCloseTo(45.6, 6);
    expect(m.yawDeg).toBeCloseTo(270.0, 6);
  });

  it('falls back to gps_altitude_mm when AbsoluteAltitude is missing', () => {
    const buf = buildProductMeta({
      lat: 46.61307,
      lon: 14.262388,
      relAltMm: 1000,
      gpsAltMm: 500123,
    });
    const m = decodeProductMeta(buf);
    expect(m.absAlt).toBeCloseTo(500.123, 3);
  });

  it('keeps near-null-island coordinates as fixes (regression)', () => {
    const buf = buildProductMeta({
      lat: 0.0000001,
      lon: 0.0000001,
      relAltMm: 0,
    });
    const m = decodeProductMeta(buf);
    expect(m.fix?.lat).toBeCloseTo(0.0000001, 9);
    expect(m.noLock).toBe(false);
  });

  it('marks the 0/0 placeholder as a no-lock position', () => {
    const buf = buildProductMeta({ lat: 0, lon: 0, relAltMm: 0 });
    const m = decodeProductMeta(buf);
    expect(m.fix).toBeNull();
    expect(m.noLock).toBe(true);
  });

  it('accepts genuine fixes near the equator / prime meridian', () => {
    const buf = buildProductMeta({ lat: 10.2, lon: 0.2, relAltMm: 1000 });
    const m = decodeProductMeta(buf);
    expect(m.fix?.lat).toBeCloseTo(10.2, 9);
    expect(m.fix?.lon).toBeCloseTo(0.2, 9);
  });

  it('keeps the camera altitude when the drone sub-message is missing', () => {
    const cam = fldBytes(2, fldBytes(11, fldFloat(1, 313.5)));
    const m = decodeProductMeta(fldBytes(3, cam));
    expect(m.absAlt).toBeCloseTo(313.5, 2);
    expect(m.fix).toBeNull();
    expect(m.noLock).toBe(false);
    expect(m.relAlt).toBeNull();
    expect(m.yawDeg).toBeNull();
    expect(m.pitchDeg).toBeNull();
    expect(m.rollDeg).toBeNull();
  });

  it('returns an all-null meta for a message without frame metadata', () => {
    expect(decodeProductMeta(Buffer.alloc(0))).toEqual({
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
    });
  });

  it('decodes camera exposure fields and the raw GPS altitude', () => {
    const buf = buildProductMeta({
      lat: 46.61307,
      lon: 14.262388,
      relAltMm: 3300,
      iso: 340,
      ct: 4435,
      gpsAltMm: 313227,
    });
    const m = decodeProductMeta(buf);
    expect(m.iso).toBe(340);
    expect(m.whiteBalanceCctK).toBe(4435);
    expect(m.gpsAltMm).toBe(313227);
  });

  it('decodes the gimbal attitude and device timestamp', () => {
    const buf = buildProductMeta({
      lat: 46.6,
      lon: 14.3,
      relAltMm: 0,
      gimbal: { pitch: -122, roll: 4, yaw: 1085, device: GIMBAL_DEVICE },
    });
    const m = decodeProductMeta(buf);
    expect(m.gimbalPitchDeg).toBeCloseTo(-12.2, 6);
    expect(m.gimbalRollDeg).toBeCloseTo(0.4, 6);
    expect(m.gimbalYawDeg).toBeCloseTo(108.5, 6);
    expect(m.gimbalDeviceTimestampMs).toBe(1234);
  });

  it('exports a wire-missing Euler member of a present message as 0.0', () => {
    const buf = buildProductMeta({
      lat: 46.6,
      lon: 14.3,
      relAltMm: 0,
      attitude: { yaw: 2700 },
      gimbal: { pitch: -122, device: GIMBAL_DEVICE },
    });
    const m = decodeProductMeta(buf);
    expect(m.pitchDeg).toBe(0);
    expect(m.rollDeg).toBe(0);
    expect(m.yawDeg).toBeCloseTo(270, 6);
    expect(m.gimbalPitchDeg).toBeCloseTo(-12.2, 6);
    expect(m.gimbalRollDeg).toBe(0);
    expect(m.gimbalYawDeg).toBe(0);
  });

  it('omits the gimbal attitude when the gimbal block is absent', () => {
    const buf = buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 0, attitude: { yaw: 900 } });
    const m = decodeProductMeta(buf);
    expect(m.gimbalPitchDeg).toBeNull();
    expect(m.gimbalRollDeg).toBeNull();
    expect(m.gimbalYawDeg).toBeNull();
    expect(m.gimbalDeviceTimestampMs).toBeNull();
  });

  it('exports the known 0.0 for a set-but-default RelativeAltitude', () => {
    const m = decodeProductMeta(buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 0 }));
    expect(m.relAlt).toBe(0);
  });

  it('never falls back to the GPS altitude where the camera says 0.0', () => {
    const m = decodeProductMeta(
      buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 3300, absAltM: 0, gpsAltMm: 313227 }),
    );
    expect(m.absAlt).toBe(0);
  });

  it('zero-defaults a wire-missing gps_altitude_mm of a present GpsBasic', () => {
    const m = decodeProductMeta(buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 3300 }));
    expect(m.gpsAltMm).toBe(0);
    expect(m.absAlt).toBe(0);
  });

  it('zero-defaults wire-missing ISO and CCT values', () => {
    const m = decodeProductMeta(
      buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 3300, iso: 0, ct: 0 }),
    );
    expect(m.iso).toBe(0);
    expect(m.whiteBalanceCctK).toBe(0);
  });
});

describe('decodeProvenance', () => {
  it('decodes the declared proto schema and the gimbal device constants', () => {
    const p = decodeProvenance(
      buildProductMeta({
        lat: 46.6,
        lon: 14.3,
        relAltMm: 0,
        clip: { protoFile: 'dvtm_NEO2.proto', productProtoVersion: 'v02.00.07' },
        gimbal: { device: GIMBAL_DEVICE },
      }),
    );
    expect(p.protoFile).toBe('dvtm_NEO2.proto v02.00.07');
    expect(p.gimbalDevice).toEqual({
      id: 0,
      type: 1,
      subType: 3,
      name: 'gimbal',
      frequency: 200,
    });
  });

  it('reports absent constants as null, never guessed', () => {
    expect(decodeProvenance(buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 0 }))).toEqual({
      protoFile: null,
      gimbalDevice: null,
    });
  });

  it('zero-defaults wire-missing constants of a present device header', () => {
    const p = decodeProvenance(
      buildProductMeta({
        lat: 46.6,
        lon: 14.3,
        relAltMm: 0,
        gimbal: { device: { id: 0, type: 0, subType: 0, name: '', frequency: 0 } },
      }),
    );
    expect(p.gimbalDevice).toEqual({
      id: 0,
      type: 0,
      subType: 0,
      name: '',
      frequency: 0,
    });
  });
});

describe('scanGpsPair', () => {
  it('finds the 0x11/0x19 fixed64 GPS pair in raw bytes', () => {
    const pair = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x11]),
      (() => {
        const b = Buffer.alloc(8);
        b.writeDoubleLE(46.61307);
        return b;
      })(),
      Buffer.from([0x19]),
      (() => {
        const b = Buffer.alloc(8);
        b.writeDoubleLE(14.262388);
        return b;
      })(),
      Buffer.from([0x00]),
    ]);
    const hit = scanGpsPair(pair);
    expect(hit).not.toBeNull();
    expect(hit?.fix.lat).toBeCloseTo(46.61307, 9);
    expect(hit?.fix.lon).toBeCloseTo(14.262388, 9);
    expect(hit?.at).toBe(2);
  });

  it('rejects the 0/0 placeholder and out-of-range pairs', () => {
    for (const [lat, lon] of [
      [0, 0],
      [91, 0],
    ]) {
      const pair = Buffer.concat([
        Buffer.from([0x11]),
        dbl(lat),
        Buffer.from([0x19]),
        dbl(lon),
      ]);
      expect(scanGpsPair(pair)).toBeNull();
    }
  });

  it('applies the same GPS-fix rule as the protobuf path', () => {
    for (const [lat, lon] of [
      [10.2, 0.2],
      [0.2, 10.2],
      [0.1, 0.1],
    ]) {
      const pair = Buffer.concat([
        Buffer.from([0x11]),
        dbl(lat),
        Buffer.from([0x19]),
        dbl(lon),
      ]);
      const hit = scanGpsPair(pair);
      expect(hit?.fix.lat).toBeCloseTo(lat, 9);
      expect(hit?.fix.lon).toBeCloseTo(lon, 9);

      const m = decodeProductMeta(buildProductMeta({ lat, lon, relAltMm: 0 }));
      expect(m.fix?.lat).toBeCloseTo(lat, 9);
      expect(m.fix?.lon).toBeCloseTo(lon, 9);
    }
  });
});

describe('decodePacketSamples', () => {
  function packetsOf(parts: Buffer[]): { buf: Buffer; packets: CamMetaPacket[] } {
    const packets: CamMetaPacket[] = [];
    let tSec = 0;
    for (const part of parts) {
      packets.push({ tSec, size: part.length });
      tSec += 1 / 30;
    }
    return { buf: Buffer.concat(parts), packets };
  }

  it('counts no-lock packets and keeps only fix samples by default', () => {
    const { buf, packets } = packetsOf([
      buildProductMeta({ lat: 0, lon: 0, relAltMm: 0 }),
      buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 0 }),
      buildProductMeta({ lat: 0.1, lon: 0.1, relAltMm: 0 }),
    ]);
    const { samples, noLock } = decodePacketSamples(buf, packets, false);
    expect(noLock).toBe(1);
    expect(samples.map((s) => s.fix?.lat)).toEqual([46.6, 0.1]);
  });

  it('keeps no-lock samples under keepAll but still counts them', () => {
    const { buf, packets } = packetsOf([
      buildProductMeta({ lat: 0, lon: 0, relAltMm: 0 }),
      buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 0 }),
    ]);
    const { samples, noLock } = decodePacketSamples(buf, packets, true);
    expect(noLock).toBe(1);
    expect(samples).toHaveLength(2);
    expect(samples[0].noLock).toBe(true);
    expect(samples[0].fix).toBeNull();
    expect(samples[1].fix?.lat).toBe(46.6);
  });

  it('collects clip constants while keeping fix-less packets frame-aligned', () => {
    const { buf, packets } = packetsOf([
      buildProductMeta({
        lat: 0,
        lon: 0,
        relAltMm: 0,
        clip: { protoFile: 'dvtm_NEO2.proto', productProtoVersion: 'v02.00.07' },
        gimbal: { device: GIMBAL_DEVICE },
      }),
      buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 0 }),
    ]);
    const { samples, noLock, provenance } = decodePacketSamples(buf, packets, true);
    expect(noLock).toBe(1);
    expect(samples).toHaveLength(2);
    expect(provenance.protoFile).toBe('dvtm_NEO2.proto v02.00.07');
    expect(provenance.gimbalDevice?.name).toBe('gimbal');
  });
});
