import { describe, expect, it } from 'vitest';

import { clampHandleFrame, engagedLoop, frameAtPointer, hasLoop } from '../../ui/lib/loop.js';

describe('engagedLoop', () => {
  it.for([
    {
      name: 'both points set and ordered engages',
      state: { in: 10, out: 20 },
      want: { in: 10, out: 20 },
    },
    { name: 'missing in point stays dormant', state: { in: null, out: 20 }, want: null },
    { name: 'missing out point stays dormant', state: { in: 10, out: null }, want: null },
    { name: 'inverted points stay dormant', state: { in: 20, out: 10 }, want: null },
    { name: 'equal points stay dormant', state: { in: 15, out: 15 }, want: null },
    { name: 'no points at all stays dormant', state: { in: null, out: null }, want: null },
  ])('$name', ({ state, want }) => {
    expect(engagedLoop(state)).toEqual(want);
  });
});

describe('hasLoop', () => {
  it.for([
    { name: 'both points set', state: { in: 10, out: 20 }, want: true },
    { name: 'half-marked loop counts', state: { in: 10, out: null }, want: true },
    { name: 'out point alone counts', state: { in: null, out: 20 }, want: true },
    { name: 'no points at all', state: { in: null, out: null }, want: false },
  ])('$name', ({ state, want }) => {
    expect(hasLoop(state)).toBe(want);
  });
});

describe('frameAtPointer', () => {
  it.for([
    { name: 'the track start', clientX: 0, rect: { left: 0, width: 100 }, maxFrame: 89, want: 0 },
    { name: 'mid track rounds to the nearest frame', clientX: 50, rect: { left: 0, width: 100 }, maxFrame: 89, want: 45 },
    { name: 'offset track', clientX: 60, rect: { left: 10, width: 100 }, maxFrame: 99, want: 50 },
    { name: 'past the end clamps', clientX: 200, rect: { left: 0, width: 100 }, maxFrame: 89, want: 89 },
    { name: 'before the start clamps', clientX: -5, rect: { left: 0, width: 100 }, maxFrame: 89, want: 0 },
    { name: 'a zero-width track lands on the start', clientX: 50, rect: { left: 0, width: 0 }, maxFrame: 89, want: 0 },
  ])('$name', ({ clientX, rect, maxFrame, want }) => {
    expect(frameAtPointer(clientX, rect, maxFrame)).toBe(want);
  });
});

describe('clampHandleFrame', () => {
  it.for([
    {
      name: 'the in end may not pass the out point',
      which: 'in' as const,
      frame: 80,
      state: { in: 30, out: 60 },
      maxFrame: 89,
      want: 59,
    },
    {
      name: 'the out end may not pass the in point',
      which: 'out' as const,
      frame: 4,
      state: { in: 30, out: 60 },
      maxFrame: 89,
      want: 31,
    },
    {
      name: 'a free end clamps to the frame range',
      which: 'in' as const,
      frame: 200,
      state: { in: null, out: null },
      maxFrame: 89,
      want: 89,
    },
  ])('$name', ({ which, frame, state, maxFrame, want }) => {
    expect(clampHandleFrame(which, frame, state, maxFrame)).toBe(want);
  });
});
