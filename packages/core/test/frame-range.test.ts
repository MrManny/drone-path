import { describe, expect, it } from 'vitest';

import { parseFrameRange, resolveFrameRange } from '../src/frame-range.js';

describe('parseFrameRange', () => {
  it('accepts an inclusive start < end range', () => {
    expect(parseFrameRange({ start: 10, end: 29 })).toEqual({ start: 10, end: 29 });
  });

  it('accepts a single-frame span (start equal to end)', () => {
    expect(parseFrameRange({ start: 5, end: 5 })).toEqual({ start: 5, end: 5 });
  });

  it.each([
    ['start after end', { start: 9, end: 2 }],
    ['negative start', { start: -1, end: 4 }],
    ['fractional index', { start: 1.5, end: 4 }],
    ['non-numeric end', { start: 0, end: 'x' }],
    ['unknown key', { start: 0, end: 4, fps: 30 }],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseFrameRange(raw)).toThrow(/invalid|unknown/);
  });

  it('rejects non-object input', () => {
    expect(() => parseFrameRange(null)).toThrow('invalid frame range');
    expect(() => parseFrameRange([0, 4])).toThrow('invalid frame range');
  });
});

describe('resolveFrameRange', () => {
  it.each([null, undefined])('uses the full recording for %s', (range) => {
    expect(resolveFrameRange(range, 30)).toBeNull();
  });

  it('accepts a range ending at the last frame', () => {
    expect(resolveFrameRange({ start: 10, end: 29 }, 30)).toEqual({ start: 10, end: 29 });
  });

  it('rejects an end equal to the frame count', () => {
    expect(() => resolveFrameRange({ start: 10, end: 30 }, 30)).toThrow(
      'frame range 10-30 is beyond the recording (30 frames)',
    );
  });
});
