import { describe, expect, it } from 'vitest';

import { bearingDeg, gpsFixOrNull, haversineM } from '../src/geo.js';
import { computeTelemetry } from '../src/telemetry-math.js';
import type { TelemetrySample } from '../src/telemetry-math.js';

function sample(
  tSec: number,
  lat: number | null,
  lon: number | null,
  extras: Partial<TelemetrySample> = {},
): TelemetrySample {
  return { tSec, fix: gpsFixOrNull(lat, lon), relAlt: null, absAlt: null, yawDeg: null, ...extras };
}

function build(samples: TelemetrySample[], frames: number, fpsValue: number) {
  return computeTelemetry(
    { samples, source: 'srt', method: 'srt-cues', noLock: 0 },
    { frames, fpsValue },
  );
}

describe('computeTelemetry', () => {
  it('builds per-frame values from the samples', () => {
    const tel = build(
      [
        sample(0, 46.61307, 14.262388, { relAlt: 3.3 }),
        sample(1 / 30, 46.61308, 14.262388, { relAlt: 3.4 }),
        sample(2 / 30, 46.61309, 14.262388, { relAlt: 3.5 }),
      ],
      3,
      30,
    );

    expect(tel.headingMode).toBe('cog');
    expect(tel.sampleCount).toBe(3);
    expect(tel.fixCount).toBe(3);
    expect(tel.frames).toHaveLength(3);

    expect(tel.frames[0].fix?.lat).toBeCloseTo(46.61307, 6);
    expect(tel.frames[0].fix?.lon).toBeCloseTo(14.262388, 6);
    expect(tel.frames[0].alt).toBeCloseTo(3.3, 6);

    expect(tel.frames[1].speed).toBeCloseTo(33.4, 0);

    const heading = tel.frames[1].headingDeg;
    expect(Math.min(heading, 360 - heading)).toBeLessThan(5);

    expect(tel.bbox.minLat).toBeCloseTo(46.61307, 6);
    expect(tel.bbox.maxLat).toBeCloseTo(46.61309, 6);
    expect(tel.trackDistanceM).toBeGreaterThan(0);
    expect(tel.trackDistanceM).toBeLessThan(5);
  });

  it('counts fixes exactly when a sample has no coordinates at all', () => {
    const tel = build(
      [
        sample(0, 46.61307, 14.262388),
        sample(0.04, null, null),
        sample(0.08, 0, 0),
        sample(0.12, 46.613072, 14.26239),
      ],
      1,
      1,
    );
    expect(tel.sampleCount).toBe(4);
    expect(tel.fixCount).toBe(2);
  });

  it('carries the source provenance through', () => {
    const tel = computeTelemetry(
      {
        samples: [sample(0, 46.61307, 14.262388), sample(0.04, 46.613072, 14.26239)],
        source: 'cammeta',
        method: 'dvtm-packets',
        noLock: 7,
      },
      { frames: 1, fpsValue: 1 },
    );
    expect(tel.source).toBe('cammeta');
    expect(tel.method).toBe('dvtm-packets');
    expect(tel.noLock).toBe(7);
  });

  it('interpolates positions between fixes', () => {
    const tel = build(
      [sample(0, 46.6, 14.2), sample(1, 46.7, 14.3)],
      2,
      2,
    );
    expect(tel.frames[1].fix?.lat).toBeCloseTo(46.65, 6);
    expect(tel.frames[1].fix?.lon).toBeCloseTo(14.25, 6);
  });

  it('holds the earlier fix across long gaps instead of interpolating', () => {
    const tel = build(
      [sample(0, 46.6, 14.2), sample(10, 46.7, 14.3)],
      6,
      1,
    );
    expect(tel.frames[5].fix?.lat).toBeCloseTo(46.6, 6);
  });

  it('holds the first and last fix on frames past the telemetry ends', () => {
    const tel = build(
      [
        sample(0, null, null, { relAlt: 3.3 }),
        sample(0.04, 46.61307, 14.262388),
        sample(0.08, 46.613072, 14.26239),
        sample(0.12, null, null, { relAlt: 3.6 }),
      ],
      4,
      25,
    );

    expect(tel.fixCount).toBe(2);
    expect(tel.frames[0].fix?.lat).toBeCloseTo(46.61307, 6);
    expect(tel.frames[0].fix?.lon).toBeCloseTo(14.262388, 6);
    expect(tel.frames[3].fix?.lat).toBeCloseTo(46.613072, 6);
    expect(tel.frames[3].fix?.lon).toBeCloseTo(14.26239, 6);
    expect(tel.frames[1].fix?.lat).toBeCloseTo(46.61307, 6);
    expect(tel.frames[2].fix?.lat).toBeCloseTo(46.613072, 6);
  });

  it('prefers relative altitude and falls back to absolute', () => {
    const tel = build(
      [
        sample(0, 46.61307, 14.262388, { relAlt: 3.3, absAlt: 313.2 }),
        sample(0.04, 46.613071, 14.262389, { relAlt: null, absAlt: 313.3 }),
      ],
      2,
      25,
    );
    expect(tel.frames[0].alt).toBeCloseTo(3.3, 6);
    expect(tel.frames[1].alt).toBeCloseTo(313.3, 6);
  });

  describe('heading', () => {
    it('back-fills leading headings from the first known heading', () => {
      const samples: TelemetrySample[] = [];
      for (let i = 0; i <= 70; i++) {
        let lat = 46.613;
        let lon = 14.262;
        if (i >= 21 && i <= 40) lat += (i - 20) * 0.00001;
        if (i >= 41) {
          lat += 20 * 0.00001;
          lon += (i - 40) * 0.00001;
        }
        samples.push(sample(i * 0.04, lat, lon, { relAlt: 3.3 }));
      }

      const tel = build(samples, 71, 25);

      expect(tel.headingMode).toBe('cog');
      const first = tel.frames[0].headingDeg;
      expect(Math.min(first, 360 - first)).toBeLessThan(30);
      const last = tel.frames[70].headingDeg;
      expect(Math.abs(last - 90)).toBeLessThan(30);
    });

    it('tracks course over ground on slow flights instead of holding one value', () => {
      const samples: TelemetrySample[] = [];
      for (let i = 0; i <= 124; i++) {
        samples.push(
          sample(i * 0.04, 46.613, 14.262 + i * 0.00000052, { relAlt: 3.3 }),
        );
      }

      const tel = build(samples, 125, 25);

      expect(tel.headingMode).toBe('cog');
      for (const frame of [30, 60, 90, 120]) {
        expect(Math.abs(tel.frames[frame].headingDeg - 90)).toBeLessThan(25);
      }
    });

    it('prefers body yaw over course over ground and normalizes it', () => {
      const tel = build(
        [
          sample(0, 46.61307, 14.262388, { yawDeg: 400 }),
          sample(0.04, 46.613071, 14.262389, { yawDeg: 400 }),
        ],
        2,
        25,
      );
      expect(tel.headingMode).toBe('yaw');
      expect(tel.frames[0].headingDeg).toBeCloseTo(40, 0);
      expect(tel.frames[1].headingDeg).toBeCloseTo(40, 0);
    });

    it('preserves speed and COG heading across mid-flight and edge no-lock gaps', () => {
      // Northbound leg (t = 0..0.4s) then Eastbound leg (t = 0.5..1.5s) with
      // mid-flight no-lock cues at t = 0.8..1.0s and a trailing no-lock cue.
      const samples: TelemetrySample[] = [sample(0, null, null)];
      for (let i = 1; i <= 4; i++) {
        samples.push(sample(i * 0.1, 46.613 + i * 0.00001, 14.262));
      }
      for (let i = 5; i <= 15; i++) {
        const isGap = i >= 8 && i <= 10;
        samples.push(
          isGap
            ? sample(i * 0.1, null, null)
            : sample(i * 0.1, 46.613 + 0.00004, 14.262 + (i - 4) * 0.000015),
        );
      }
      samples.push(sample(1.6, 0, 0));

      const srtTel = build(samples, 17, 10);
      const fixOnlyTel = computeTelemetry(
        {
          samples: samples.filter((s) => s.fix !== null),
          source: 'cammeta',
          method: 'dvtm-packets',
          noLock: 5,
        },
        { frames: 17, fpsValue: 10 },
      );

      expect(srtTel.sampleCount).toBe(17);
      expect(srtTel.fixCount).toBe(12);
      for (let frame = 8; frame <= 10; frame++) {
        expect(srtTel.frames[frame].speed).toBeGreaterThan(5);
        expect(Math.abs(srtTel.frames[frame].headingDeg - 90)).toBeLessThan(20);
      }
      expect(Math.abs(srtTel.frames[16].headingDeg - 90)).toBeLessThan(20);

      for (let frame = 1; frame <= 15; frame++) {
        expect(srtTel.frames[frame].speed).toBe(fixOnlyTel.frames[frame].speed);
        expect(srtTel.frames[frame].headingDeg).toBe(fixOnlyTel.frames[frame].headingDeg);
      }
    });

    it('preserves yaw heading across mid-flight no-lock gaps', () => {
      const tel = build(
        [
          sample(0, 46.613, 14.262, { yawDeg: 135 }),
          sample(0.5, null, null),
          sample(1, 46.6131, 14.2621, { yawDeg: 135 }),
        ],
        3,
        2,
      );

      expect(tel.headingMode).toBe('yaw');
      expect(tel.frames[1].headingDeg).toBeCloseTo(135, 1);
      expect(tel.frames[1].speed).toBeGreaterThan(0);
    });
  });

  describe('two-fix tracks', () => {
    it.for([
      {
        name: '1s Eastbound move',
        a: sample(0, 46.613, 14.262),
        b: sample(1, 46.613, 14.2622),
        frames: 3,
        fpsValue: 2,
      },
      {
        name: 'long 5s Southbound gap exceeding max baseline',
        a: sample(0, 46.6132, 14.262),
        b: sample(5, 46.613, 14.262),
        frames: 6,
        fpsValue: 1,
      },
    ])('computes forward-difference speed and COG heading for $name', ({ a, b, frames, fpsValue }) => {
      const tel = build([a, b], frames, fpsValue);
      const expectedSpeed =
        Math.round((haversineM(a.fix!, b.fix!) / (b.tSec - a.tSec)) * 10) / 10;
      const expectedHeading = Math.round(bearingDeg(a.fix!, b.fix!) * 10) / 10;

      expect(tel.headingMode).toBe('cog');
      for (const frame of tel.frames) {
        expect(frame.speed).toBe(expectedSpeed);
        expect(frame.headingDeg).toBe(expectedHeading);
      }
    });

    it('computes forward-difference speed and COG heading when no-lock cues sit between two fixes', () => {
      const a = sample(0, 46.613, 14.262);
      const b = sample(1.5, 46.613, 14.2623);
      const tel = build(
        [a, sample(0.5, null, null), sample(1, 0, 0), b],
        4,
        2,
      );

      const expectedSpeed = Math.round((haversineM(a.fix!, b.fix!) / 1.5) * 10) / 10;
      const expectedHeading = Math.round(bearingDeg(a.fix!, b.fix!) * 10) / 10;
      for (const frame of tel.frames) {
        expect(frame.speed).toBe(expectedSpeed);
        expect(frame.headingDeg).toBe(expectedHeading);
      }
    });

    it.for([
      {
        name: 'zero elapsed time',
        samples: [sample(1, 46.613, 14.262), sample(1, 46.613, 14.2622)],
        expectedSpeed: 0,
      },
      {
        name: 'stationary coordinates',
        samples: [sample(0, 46.613, 14.262), sample(1, 46.613, 14.262)],
        expectedSpeed: 0,
      },
      {
        name: 'speed below COG threshold',
        samples: [sample(0, 46.613, 14.262), sample(10, 46.613, 14.26203)],
        expectedSpeed: 0.2,
      },
      {
        name: 'displacement below COG minimum move',
        samples: [sample(0, 46.613, 14.262), sample(0.5, 46.613, 14.262013)],
        expectedSpeed: 2,
      },
    ])('falls back to 0° COG heading on $name', ({ samples, expectedSpeed }) => {
      const tel = build(samples, 2, 1);

      expect(tel.headingMode).toBe('cog');
      expect(tel.frames[0].speed).toBeCloseTo(expectedSpeed, 1);
      expect(tel.frames[0].headingDeg).toBe(0);
      expect(tel.frames[1].headingDeg).toBe(0);
    });
  });

  describe.for([
    { name: 'no samples at all', samples: [] as TelemetrySample[] },
    { name: 'a single fix', samples: [sample(0, 46.61307, 14.262388)] },
    {
      name: 'only placeholders',
      samples: [sample(0, 0, 0), sample(0.04, 0, 0)],
    },
    {
      name: 'one fix among placeholders',
      samples: [sample(0, 0, 0), sample(0.04, 46.61307, 14.262388)],
    },
  ])('rejects $name', ({ samples }) => {
    it('throws before planning any frames', () => {
      expect(() => build(samples, 1, 1)).toThrow(
        'telemetry has fewer than 2 GPS fixes',
      );
    });
  });
});
