import { describe, expect, it } from 'vitest';

import {
  clampFrame,
  formatFrameRange,
  formatFrameSpan,
  formatLoopReadout,
  formatTime,
  formatTimeReadout,
  frameFromMediaTime,
  timelineTicks,
} from '../../ui/lib/frametime.js';

describe('frameFromMediaTime', () => {
  it.for([
    { name: 'exact frame', mediaTime: 0.5, fps: 30, frames: 300, want: 15 },
    { name: 'half frame floors', mediaTime: 0.05, fps: 30, frames: 300, want: 1 },
    { name: 'just below a frame floors', mediaTime: 0.0332, fps: 30, frames: 300, want: 0 },
    { name: 'clamps below zero', mediaTime: -5, fps: 30, frames: 300, want: 0 },
    { name: 'clamps past the end', mediaTime: 100, fps: 30, frames: 300, want: 299 },
    { name: 'single frame stays zero', mediaTime: 3, fps: 30, frames: 1, want: 0 },
  ])('$name', ({ mediaTime, fps, frames, want }) => {
    expect(frameFromMediaTime(mediaTime, fps, frames)).toBe(want);
  });
});

const NTSC = 30000 / 1001;

describe('frameFromMediaTime on µs-quantized media times (#92)', () => {
  it.for([
    { name: 'frame 329 at 30000/1001 fps', mediaTime: 10.977633, fps: NTSC, frames: 330, want: 329 },
    { name: 'frame 320 at 30000/1001 fps', mediaTime: 10.677333, fps: NTSC, frames: 330, want: 320 },
    { name: 'evidence sample frame 34 at 29.97 fps', mediaTime: 1.134467, fps: 29.97, frames: 330, want: 34 },
    { name: 'evidence sample frame 37 at 29.97 fps', mediaTime: 1.267933, fps: 29.97, frames: 330, want: 37 },
    { name: 'the duration clamps to the last frame', mediaTime: 11.011, fps: NTSC, frames: 330, want: 329 },
    { name: 'mid-frame clock time floors to its own frame', mediaTime: 21.5 / 30, fps: 30, frames: 300, want: 21 },
    { name: 'late clock time stays on its own frame', mediaTime: 319.999 / NTSC, fps: NTSC, frames: 330, want: 319 },
  ])('$name', ({ mediaTime, fps, frames, want }) => {
    expect(frameFromMediaTime(mediaTime, fps, frames)).toBe(want);
  });
});

describe('frameFromMediaTime on exact-second PTS frames (#92)', () => {
  it.for([
    { frame: 90, mediaTime: 3.003 },
    { frame: 150, mediaTime: 5.005 },
    { frame: 240, mediaTime: 8.008 },
    { frame: 270, mediaTime: 9.009 },
  ])('frame $frame at $mediaTime stays exact', ({ frame, mediaTime }) => {
    expect(frameFromMediaTime(mediaTime, NTSC, 330)).toBe(frame);
  });
});

describe('clampFrame', () => {
  it.for([
    { name: 'in range passes through', i: 15, frames: 300, want: 15 },
    { name: 'clamps below zero', i: -5, frames: 300, want: 0 },
    { name: 'clamps past the last frame', i: 300, frames: 300, want: 299 },
    { name: 'single frame stays zero', i: 7, frames: 1, want: 0 },
  ])('$name', ({ i, frames, want }) => {
    expect(clampFrame(i, frames)).toBe(want);
  });
});

describe('formatTime', () => {
  it.for([
    { sec: 0, want: '0:00' },
    { sec: 65, want: '1:05' },
    { sec: 125.4, want: '2:05' },
    { sec: -5, want: '0:00' },
  ])('formats $sec as $want', ({ sec, want }) => {
    expect(formatTime(sec)).toBe(want);
  });
});

describe('formatTimeReadout', () => {
  it.for([
    { name: 'start of the recording', frame: 0, fps: 30, durationSec: 3, want: '0:00 / 0:03' },
    { name: 'mid-recording', frame: 30, fps: 30, durationSec: 3, want: '0:01 / 0:03' },
    { name: 'last frame rounds up', frame: 89, fps: 30, durationSec: 3, want: '0:03 / 0:03' },
    { name: 'fractional rates', frame: 60, fps: 29.97, durationSec: 65, want: '0:02 / 1:05' },
    { name: 'no recording loaded', frame: 0, fps: 0, durationSec: 0, want: '0:00 / 0:00' },
  ])('$name', ({ frame, fps, durationSec, want }) => {
    expect(formatTimeReadout(frame, fps, durationSec)).toBe(want);
  });
});

describe('formatFrameSpan', () => {
  it.for([
    { name: 'both points set', start: 300, end: 360, fps: 30, want: '0:10–0:12' },
    { name: 'unset start reads as …', start: null, end: 360, fps: 30, want: '…–0:12' },
    { name: 'unset end reads as …', start: 300, end: null, fps: 30, want: '0:10–…' },
    { name: 'both unset read as …', start: null, end: null, fps: 30, want: '…–…' },
  ])('$name', ({ start, end, fps, want }) => {
    expect(formatFrameSpan(start, end, fps)).toBe(want);
  });
});

describe('formatFrameRange', () => {
  it('reads the segment as times and the inclusive frame count', () => {
    expect(formatFrameRange({ in: 300, out: 360 }, 30)).toBe('0:10–0:12 · 61 frames');
  });

  it('counts a single-frame segment as one frame', () => {
    expect(formatFrameRange({ in: 300, out: 300 }, 30)).toBe('0:10–0:10 · 1 frames');
  });
});

describe('formatLoopReadout', () => {
  it.for([
    { name: 'engaged loop', loop: { in: 300, out: 360 }, fps: 30, want: 'loop 0:10–0:12' },
    { name: 'unset in point still reads', loop: { in: null, out: 360 }, fps: 30, want: 'loop …–0:12' },
    { name: 'unset out point still reads', loop: { in: 300, out: null }, fps: 30, want: 'loop 0:10–…' },
    { name: 'out-of-order points still read', loop: { in: 360, out: 300 }, fps: 30, want: 'loop 0:12–0:10' },
    { name: 'no points reads empty', loop: { in: null, out: null }, fps: 30, want: '' },
  ])('$name', ({ loop, fps, want }) => {
    expect(formatLoopReadout(loop, fps)).toBe(want);
  });

  it('says what is missing instead of showing a bare ? (#233)', () => {
    expect(formatLoopReadout({ in: 300, out: null }, 30)).toBe('loop 0:10–…');
    expect(formatLoopReadout({ in: null, out: 360 }, 30)).toBe('loop …–0:12');
  });
});

describe('timelineTicks', () => {
  it.for([
    { name: 'no duration', duration: 0, want: [] },
    { name: 'a sub-second clip', duration: 0.5, want: [0, 1] },
    { name: 'a three-second clip', duration: 3, want: [0, 1, 2, 3] },
    { name: 'a clip just past a step', duration: 2.4, want: [0, 1, 2] },
    { name: 'a minute of footage', duration: 60, want: [0, 10, 20, 30, 40, 50, 60] },
    { name: 'the two-minute recording', duration: 118, want: [0, 20, 40, 60, 80, 100, 118] },
    {
      name: 'a long recording keeps few ticks',
      duration: 3600,
      want: [0, 600, 1200, 1800, 2400, 3000, 3600],
    },
  ])('$name', ({ duration, want }) => {
    expect(timelineTicks(duration)).toEqual(want);
  });

  it('always starts at 0 and ends at the duration', () => {
    for (const duration of [1.7, 9, 33, 75, 200, 1500, 7200]) {
      const ticks = timelineTicks(duration);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(Math.round(duration));
    }
  });
});
