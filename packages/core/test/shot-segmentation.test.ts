import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M } from '../src/geo.js';
import { segmentFlightShots } from '../src/shot-segmentation.js';
import type { ShotType } from '../src/shot-segmentation.js';
import type { TrackRecord } from '../src/track.js';

const BASE_LAT = 46.6;
const BASE_LON = 14.26;
const METERS_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;
const METERS_PER_DEG_LON = METERS_PER_DEG_LAT * Math.cos((BASE_LAT * Math.PI) / 180);

function offsetPoint(northM: number, eastM: number): { lat: number; lng: number } {
  return {
    lat: BASE_LAT + northM / METERS_PER_DEG_LAT,
    lng: BASE_LON + eastM / METERS_PER_DEG_LON,
  };
}

function makeLinearTrack(
  durationSec: number,
  fps: number,
  build: (tSec: number) => Partial<TrackRecord>,
): TrackRecord[] {
  const count = Math.round(durationSec * fps) + 1;
  const records: TrackRecord[] = [];
  for (let i = 0; i < count; i++) {
    const tSec = i / fps;
    records.push({ tSec, ...build(tSec) });
  }
  return records;
}

describe('segmentFlightShots', () => {
  it.each([
    ['empty', []],
    ['single sample', [{ tSec: 0, lat: BASE_LAT, lng: BASE_LON, altRel: 20 }]],
    [
      'short span under 1 s',
      [
        { tSec: 0, lat: BASE_LAT, lng: BASE_LON, altRel: 20 },
        { tSec: 0.9, lat: BASE_LAT, lng: BASE_LON, altRel: 20 },
      ],
    ],
  ])('returns [] for %s', (_label, records) => {
    expect(segmentFlightShots(records)).toEqual([]);
  });

  it.each<{
    name: string;
    expectedType: ShotType;
    records: TrackRecord[];
    minSmoothness: number;
    maxSmoothness?: number;
    exposureStable: boolean;
  }>([
    {
      name: 'steady hover (30 fps DVTM)',
      expectedType: 'hover',
      minSmoothness: 0.9,
      exposureStable: true,
      records: makeLinearTrack(6, 30, () => ({
        ...offsetPoint(0, 0),
        altRel: 30,
        yawDeg: 90,
        gimbalPitchDeg: -20,
        gimbalYawDeg: 90,
        iso: 100,
        whiteBalanceCctK: 5500,
      })),
    },
    {
      name: 'takeoff climb near start',
      expectedType: 'takeoff',
      minSmoothness: 0.8,
      exposureStable: true,
      records: makeLinearTrack(5, 10, (t) => ({
        ...offsetPoint(0, 0),
        altRel: 1 + t * 2.0,
        yawDeg: 0,
        gimbalPitchDeg: 0,
      })),
    },
    {
      name: 'smooth cinematic glide (30 fps)',
      expectedType: 'smooth-glide',
      minSmoothness: 0.85,
      exposureStable: true,
      records: makeLinearTrack(8, 30, (t) => ({
        ...offsetPoint(t * 5, 0),
        altRel: 40,
        yawDeg: 0,
        gimbalPitchDeg: -15,
        gimbalYawDeg: 0,
        iso: 200,
        whiteBalanceCctK: 5200,
      })),
    },
    {
      name: 'steady circular orbit',
      expectedType: 'orbit',
      minSmoothness: 0.85,
      exposureStable: true,
      records: makeLinearTrack(10, 10, (t) => {
        const radiusM = 20;
        const omega = (18 * Math.PI) / 180;
        const angle = omega * t;
        return {
          ...offsetPoint(radiusM * Math.cos(angle), radiusM * Math.sin(angle)),
          altRel: 35,
          yawDeg: (angle * 180) / Math.PI,
          gimbalPitchDeg: -25,
        };
      }),
    },
    {
      name: 'gimbal pitch reveal while hovering',
      expectedType: 'gimbal-reveal',
      minSmoothness: 0.85,
      exposureStable: true,
      records: makeLinearTrack(6, 10, (t) => ({
        ...offsetPoint(0, 0),
        altRel: 50,
        yawDeg: 45,
        gimbalPitchDeg: -90 + t * 10,
        gimbalYawDeg: 45,
      })),
    },
    {
      name: 'jerky high-acceleration reposition',
      expectedType: 'reposition',
      minSmoothness: 0,
      maxSmoothness: 0.5,
      exposureStable: true,
      records: [0, 1, 2, 3, 4, 5, 6].map((t) => {
        const positions = [0, 0, 10, 11, 23, 24, 38];
        const yaws = [0, 90, 10, 110, 20, 140, 10];
        return {
          tSec: t,
          ...offsetPoint(positions[t], 0),
          altRel: 30,
          yawDeg: yaws[t],
        };
      }),
    },
    {
      name: 'SRT-only glide without gimbal telemetry (COG fallback)',
      expectedType: 'smooth-glide',
      minSmoothness: 0.85,
      exposureStable: true,
      records: makeLinearTrack(6, 1, (t) => ({
        ...offsetPoint(0, t * 4),
        altRel: 25,
        iso: 100,
        shutterTime: 0.005,
        whiteBalanceCctK: 5600,
      })),
    },
    {
      name: 'SRT-only hover without gimbal telemetry',
      expectedType: 'hover',
      minSmoothness: 0.9,
      exposureStable: true,
      records: makeLinearTrack(5, 1, () => ({
        ...offsetPoint(0, 0),
        altRel: 15,
        iso: 100,
        shutterTime: 0.01,
      })),
    },
  ])('classifies $name', ({ expectedType, records, minSmoothness, maxSmoothness, exposureStable }) => {
    const shots = segmentFlightShots(records);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({
      type: expectedType,
      exposureStable,
      startSec: 0,
    });
    expect(shots[0].durationSec).toBeGreaterThanOrEqual(4);
    expect(shots[0].smoothness).toBeGreaterThanOrEqual(minSmoothness);
    if (maxSmoothness !== undefined) {
      expect(shots[0].smoothness).toBeLessThanOrEqual(maxSmoothness);
    }
    expect(segmentFlightShots(records)).toEqual(shots);
  });

  it('classifies landing near clip end and transitions across takeoff, glide, and landing', () => {
    const records = makeLinearTrack(16, 1, (t) => {
      if (t <= 4) {
        return { ...offsetPoint(0, 0), altRel: t * 2.5, yawDeg: 0 };
      }
      if (t <= 11) {
        return { ...offsetPoint((t - 4) * 4, 0), altRel: 10, yawDeg: 0 };
      }
      return { ...offsetPoint(28, 0), altRel: Math.max(0, 10 - (t - 11) * 2.0), yawDeg: 0 };
    });

    const shots = segmentFlightShots(records);
    expect(shots.map((s) => s.type)).toEqual(['takeoff', 'smooth-glide', 'landing']);
    expect(shots[0].startSec).toBe(0);
    expect(shots[2].endSec).toBe(16);
  });

  it('uses COG bearing on SRT-only clips to detect orbits without yawDeg', () => {
    const records = makeLinearTrack(10, 1, (t) => {
      const radiusM = 25;
      const omega = (15 * Math.PI) / 180;
      const angle = omega * t;
      return {
        ...offsetPoint(radiusM * Math.cos(angle), radiusM * Math.sin(angle)),
        altRel: 40,
      };
    });
    const shots = segmentFlightShots(records);
    expect(shots).toHaveLength(1);
    expect(shots[0].type).toBe('orbit');
    expect(shots[0].meanYawRateDegPerSec).toBeCloseTo(15, 0);
  });

  it('flags exposure instability on ISO, shutter, or white-balance CCT jumps', () => {
    const base = (t: number): TrackRecord => ({
      tSec: t,
      ...offsetPoint(t * 3, 0),
      altRel: 20,
      yawDeg: 0,
      iso: 100,
      shutterTime: 0.01,
      whiteBalanceCctK: 5500,
    });

    const isoJump = makeLinearTrack(5, 1, (t) => ({ ...base(t), iso: t >= 3 ? 400 : 100 }));
    const shutterJump = makeLinearTrack(5, 1, (t) => ({ ...base(t), shutterTime: t >= 2 ? 0.002 : 0.01 }));
    const cctJump = makeLinearTrack(5, 1, (t) => ({ ...base(t), whiteBalanceCctK: t >= 4 ? 6000 : 5500 }));
    const minorChange = makeLinearTrack(5, 1, (t) => ({
      ...base(t),
      iso: t >= 3 ? 120 : 100,
      shutterTime: t >= 3 ? 0.012 : 0.01,
      whiteBalanceCctK: t >= 3 ? 5650 : 5500,
    }));

    expect(segmentFlightShots(isoJump)[0]?.exposureStable).toBe(false);
    expect(segmentFlightShots(shutterJump)[0]?.exposureStable).toBe(false);
    expect(segmentFlightShots(cctJump)[0]?.exposureStable).toBe(false);
    expect(segmentFlightShots(minorChange)[0]?.exposureStable).toBe(true);
  });

  it('coalesces transient 1-second blips into surrounding smooth-glide', () => {
    const records = makeLinearTrack(10, 1, (t) => {
      // Single 1 s heading step at [4, 5] between two smooth-glide runs
      const yawDeg = t >= 5 ? 60 : 0;
      return {
        ...offsetPoint(t * 4, 0),
        altRel: 30,
        yawDeg,
      };
    });
    const shots = segmentFlightShots(records);
    expect(shots).toHaveLength(1);
    expect(shots[0].type).toBe('smooth-glide');
    expect(shots[0].startSec).toBe(0);
    expect(shots[0].endSec).toBe(10);
  });

  it('falls back to gpsAltMm when altRel and altAbs are absent', () => {
    const records = makeLinearTrack(5, 1, (t) => ({
      ...offsetPoint(0, 0),
      gpsAltMm: Math.round((10 + t * 2) * 1000),
      yawDeg: 0,
    }));
    const shots = segmentFlightShots(records);
    expect(shots).toHaveLength(1);
    expect(shots[0].type).toBe('takeoff');
  });

  it('does not bleed an exposure step at a window boundary into the following stable segment', () => {
    const records = makeLinearTrack(8, 1, (t) => ({
      tSec: t,
      ...offsetPoint(t <= 3 ? 0 : (t - 3) * 4, 0),
      altRel: 25,
      yawDeg: 0,
      iso: t >= 3 ? 400 : 100,
      shutterTime: 0.01,
      whiteBalanceCctK: 5500,
    }));
    const shots = segmentFlightShots(records);
    expect(shots.map((s) => [s.type, s.exposureStable])).toEqual([
      ['hover', false],
      ['smooth-glide', true],
    ]);
  });

  it('does not classify > 3 s GPS gaps as hover', () => {
    const records = makeLinearTrack(12, 1, (t) => {
      const hasFix = t <= 3 || t >= 8;
      return {
        ...(hasFix ? offsetPoint(0, 0) : { lat: null, lng: null }),
        altRel: 30,
        yawDeg: 0,
      };
    });
    const shots = segmentFlightShots(records);
    expect(shots.map((s) => s.type)).toEqual(['hover', 'reposition', 'hover']);
  });

  it.each([
    { name: 'clockwise 350 -> 10 wrap', startDeg: 340, rateDegPerSec: 15, expectedType: 'orbit' as const },
    { name: 'counter-clockwise 10 -> 350 wrap', startDeg: 25, rateDegPerSec: -15, expectedType: 'orbit' as const },
    { name: 'gentle 358 -> 2 glide wrap', startDeg: 358, rateDegPerSec: 1, expectedType: 'smooth-glide' as const },
  ])('handles 0/360 yaw wrap-around for $name', ({ startDeg, rateDegPerSec, expectedType }) => {
    const records = makeLinearTrack(6, 10, (t) => {
      const yawDeg = (((startDeg + rateDegPerSec * t) % 360) + 360) % 360;
      return {
        ...offsetPoint(t * 4, 0),
        altRel: 30,
        yawDeg,
      };
    });
    const shots = segmentFlightShots(records);
    expect(shots).toHaveLength(1);
    expect(shots[0].type).toBe(expectedType);
    expect(shots[0].meanYawRateDegPerSec).toBeCloseTo(rateDegPerSec, 1);
  });
});
