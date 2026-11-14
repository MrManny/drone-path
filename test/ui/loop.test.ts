import { describe, expect, it } from 'vitest';

import {
  clampHandleFrame,
  frameAtPointer,
  frameRangeOf,
  hasLoop,
  markLoopPoint,
  resolveLoop,
} from '../../ui/lib/loop.js';

describe('resolveLoop', () => {
  it.for([
    {
      name: 'both points set and ordered resolve verbatim',
      state: { in: 10, out: 20 },
      maxFrame: 89,
      want: { in: 10, out: 20 },
    },
    {
      name: 'a lone in point runs to the track end',
      state: { in: 10, out: null },
      maxFrame: 89,
      want: { in: 10, out: 89 },
    },
    {
      name: 'a lone out point runs from the track start',
      state: { in: null, out: 20 },
      maxFrame: 89,
      want: { in: 0, out: 20 },
    },
    {
      name: 'a lone in point at the first frame still spans',
      state: { in: 0, out: null },
      maxFrame: 89,
      want: { in: 0, out: 89 },
    },
    {
      name: 'a lone out point at the last frame still spans',
      state: { in: null, out: 89 },
      maxFrame: 89,
      want: { in: 0, out: 89 },
    },
    {
      name: 'no points at all resolves to no loop',
      state: { in: null, out: null },
      maxFrame: 89,
      want: null,
    },
    {
      name: 'inverted points are a dead state',
      state: { in: 20, out: 10 },
      maxFrame: 89,
      want: null,
    },
    {
      name: 'equal points are a dead state',
      state: { in: 15, out: 15 },
      maxFrame: 89,
      want: null,
    },
    {
      name: 'a one-frame track resolves a lone in point to that frame',
      state: { in: 0, out: null },
      maxFrame: 0,
      want: { in: 0, out: 0 },
    },
  ])('$name', ({ state, maxFrame, want }) => {
    expect(resolveLoop(state, maxFrame)).toEqual(want);
  });
});

describe('markLoopPoint', () => {
  it.for([
    {
      name: 'marks a first point into an empty state',
      state: { in: null, out: null },
      which: 'in' as const,
      frame: 30,
      want: { in: 30, out: null },
    },
    {
      name: 'moves an in point that is set again',
      state: { in: 30, out: null },
      which: 'in' as const,
      frame: 10,
      want: { in: 10, out: null },
    },
    {
      name: 'keeps both points when the in lands before the out',
      state: { in: 30, out: 60 },
      which: 'in' as const,
      frame: 40,
      want: { in: 40, out: 60 },
    },
    {
      name: 'keeps both points when the out lands after the in',
      state: { in: 30, out: 60 },
      which: 'out' as const,
      frame: 50,
      want: { in: 30, out: 50 },
    },
    {
      name: 'an in point past the out supersedes the stale out',
      state: { in: 30, out: 60 },
      which: 'in' as const,
      frame: 70,
      want: { in: 70, out: null },
    },
    {
      name: 'an in point at the out supersedes the stale out',
      state: { in: 30, out: 60 },
      which: 'in' as const,
      frame: 60,
      want: { in: 60, out: null },
    },
    {
      name: 'an out point before the in supersedes the stale in',
      state: { in: 30, out: 60 },
      which: 'out' as const,
      frame: 20,
      want: { in: null, out: 20 },
    },
    {
      name: 'an out point at the in supersedes the stale in',
      state: { in: 30, out: 60 },
      which: 'out' as const,
      frame: 30,
      want: { in: null, out: 30 },
    },
    {
      name: 'a new in supersedes a stale out even from a crossed state',
      state: { in: 60, out: 30 },
      which: 'in' as const,
      frame: 50,
      want: { in: 50, out: null },
    },
    {
      name: 'a new out supersedes a stale in even from a crossed state',
      state: { in: 60, out: 30 },
      which: 'out' as const,
      frame: 40,
      want: { in: null, out: 40 },
    },
  ])('$name', ({ state, which, frame, want }) => {
    expect(markLoopPoint(state, which, frame)).toEqual(want);
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
    {
      name: 'a lone end clamps to the frame range',
      which: 'out' as const,
      frame: -5,
      state: { in: null, out: 30 },
      maxFrame: 89,
      want: 0,
    },
  ])('$name', ({ which, frame, state, maxFrame, want }) => {
    expect(clampHandleFrame(which, frame, state, maxFrame)).toBe(want);
  });
});

describe('frameRangeOf', () => {
  it('maps resolved loop points onto the export request range', () => {
    expect(frameRangeOf({ in: 10, out: 20 })).toEqual({ start: 10, end: 20 });
    expect(frameRangeOf({ in: 0, out: 0 })).toEqual({ start: 0, end: 0 });
  });
});
