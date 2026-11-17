import { describe, expect, it } from 'vitest';

import type { RecordingSummary } from '../../src/pipeline.js';
import { formatExportSummary } from '../../ui/lib/exportsummary.js';

function summary(overrides: Partial<RecordingSummary> = {}): RecordingSummary {
  return {
    video: '/recordings/flight.mp4',
    out: '/exports/flight-map.mp4',
    status: 'ok',
    elapsedSec: 4,
    frames: 120,
    fps: '30000/1001',
    width: 1280,
    height: 720,
    ...overrides,
  };
}

describe('formatExportSummary', () => {
  it.for<{ name: string; overrides: Partial<RecordingSummary>; want: string }>([
    {
      name: 'a ratio rate',
      overrides: {},
      want: '120 frames @ 29.97 fps · 4 s · 1280×720',
    },
    {
      name: 'a whole rate',
      overrides: { fps: '30' },
      want: '120 frames @ 30 fps · 4 s · 1280×720',
    },
    {
      name: 'a media duration past the half second',
      overrides: { frames: 380, fps: '30' },
      want: '380 frames @ 30 fps · 13 s · 1280×720',
    },
    {
      name: 'sub-second media',
      overrides: { frames: 10, fps: '30' },
      want: '10 frames @ 30 fps · <1 s · 1280×720',
    },
    {
      name: 'the even rendered sizes, not the typed ones',
      overrides: { width: 1278, height: 718 },
      want: '120 frames @ 29.97 fps · 4 s · 1278×718',
    },
    {
      name: 'a missing rate without rate or duration',
      overrides: { fps: undefined },
      want: '120 frames · 1280×720',
    },
    {
      name: 'an empty rate without rate or duration',
      overrides: { fps: '' },
      want: '120 frames · 1280×720',
    },
    {
      name: 'an unparseable rate without a duration',
      overrides: { fps: 'abc' },
      want: '120 frames @ abc · 1280×720',
    },
    {
      name: 'a zero frame count without a duration',
      overrides: { frames: 0 },
      want: '0 frames @ 29.97 fps · 1280×720',
    },
    {
      name: 'the media duration of a 12 s loop, never its encode time (#284)',
      overrides: { frames: 361, elapsedSec: 9, width: 768, height: 768 },
      want: '361 frames @ 29.97 fps · 12 s · 768×768',
    },
  ])('reads $name as $want', ({ overrides, want }) => {
    expect(formatExportSummary(summary(overrides))).toBe(want);
  });

  it('never shows the encode wall time where readers expect media duration (#284)', () => {
    expect(formatExportSummary(summary({ frames: 361, elapsedSec: 9 }))).not.toContain('9 s');
  });
});
