import { describe, expect, it } from 'vitest';

import {
  formatFps,
  framesForSeconds,
  parseFpsRate,
  parseRate,
  timeAt,
} from '../src/frametime.js';

describe('parseRate', () => {
  it('reads a rational rate', () => {
    expect(parseRate('30000/1001')).toEqual({ num: 30000, den: 1001 });
  });

  it('reads a bare integer as a whole-number rate', () => {
    expect(parseRate('30')).toEqual({ num: 30, den: undefined });
  });

  it('rejects a non-numeric rate', () => {
    expect(parseRate('abc')).toBeNull();
  });
});

describe('parseFpsRate', () => {
  it('reads a rational rate into its decimal value and canonical string', () => {
    expect(parseFpsRate('30000/1001')).toEqual({
      num: 30000,
      den: 1001,
      value: 30000 / 1001,
      str: '30000/1001',
    });
  });

  it('collapses a whole-number rate to its plain string', () => {
    expect(parseFpsRate('30/1')).toEqual({ num: 30, den: 1, value: 30, str: '30' });
  });

  it.each([undefined, '', 'abc', '0/0', '30/0', '0/1', '30'])(
    'rejects %j as unusable',
    (str) => {
      expect(parseFpsRate(str)).toBeNull();
    },
  );
});

describe.each([
  { rate: '60000/1001', text: '59.94 fps' },
  { rate: '30000/1001', text: '29.97 fps' },
  { rate: '24000/1001', text: '23.98 fps' },
  { rate: '30', text: '30 fps' },
  { rate: '25/1', text: '25 fps' },
])('formatFps($rate)', ({ rate, text }) => {
  it('reads the rate as decimal fps', () => {
    expect(formatFps(rate)).toBe(text);
  });
});

describe.each(['0/0', '30/0', '', 'abc'])('formatFps(%j) without a usable rate', (rate) => {
  it('passes the raw value through unchanged', () => {
    expect(formatFps(rate)).toBe(rate);
  });
});

describe('timeAt', () => {
  it('divides the frame index by the rate', () => {
    expect(timeAt(30, 30)).toBe(1);
    expect(timeAt(15, 30)).toBe(0.5);
  });

  it('reads a zero rate as frame zero (#167)', () => {
    expect(timeAt(0, 0)).toBe(0);
    expect(timeAt(5, 0)).toBe(0);
  });
});

describe('framesForSeconds', () => {
  it.for([
    { name: 'exact rate', fps: 30, seconds: 1, want: 30 },
    { name: '29.97 rounds up', fps: 29.97, seconds: 1, want: 30 },
    { name: '23.976 rounds to 24', fps: 23.976, seconds: 1, want: 24 },
    { name: '50 fps', fps: 50, seconds: 1, want: 50 },
    { name: 'negative jumps keep the sign', fps: 30, seconds: -1, want: -30 },
    { name: 'negative fractional rate', fps: 29.97, seconds: -1, want: -30 },
  ])('$name', ({ fps, seconds, want }) => {
    expect(framesForSeconds(fps, seconds)).toBe(want);
  });
});
