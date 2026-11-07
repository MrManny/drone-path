import { describe, expect, it } from 'vitest';

import { CHROME, COMPACT_HEIGHT, mapFrameSize, stageHeight } from '../../ui/lib/layout.js';

describe('stageHeight', () => {
  it.for([
    { name: 'a typical window', innerHeight: 950, want: 950 - 336 },
    { name: 'the compact boundary', innerHeight: COMPACT_HEIGHT, want: COMPACT_HEIGHT - 276 },
    { name: 'just above the compact boundary', innerHeight: COMPACT_HEIGHT + 1, want: COMPACT_HEIGHT + 1 - 336 },
    { name: 'the window minimum', innerHeight: 600, want: 600 - 276 },
    { name: 'a tiny window clamps at zero', innerHeight: 100, want: 0 },
  ])('$name', ({ innerHeight, want }) => {
    expect(stageHeight(innerHeight)).toBe(want);
  });

  it('accounts for every chrome height exactly once', () => {
    const wide = CHROME.headerH + CHROME.transportH + CHROME.timelineH + CHROME.statusH;
    expect(stageHeight(950)).toBe(950 - wide);
  });
});

describe('mapFrameSize', () => {
  it.for([
    {
      name: 'split at the default window',
      innerWidth: 1600,
      innerHeight: 950,
      layout: 'split' as const,
      want: { width: 372, height: 582 },
    },
    {
      name: 'split at the window minimum clamps the rail to its floor',
      innerWidth: 1024,
      innerHeight: 600,
      layout: 'split' as const,
      want: { width: 280, height: 292 },
    },
    {
      name: 'split between the rail bounds',
      innerWidth: 1200,
      innerHeight: 950,
      layout: 'split' as const,
      want: { width: 327, height: 582 },
    },
    {
      name: 'overlay at the default window',
      innerWidth: 1600,
      innerHeight: 950,
      layout: 'overlay' as const,
      want: { width: 221, height: 221 },
    },
    {
      name: 'overlay clamps to the minimum box',
      innerWidth: 1024,
      innerHeight: 600,
      layout: 'overlay' as const,
      want: { width: 180, height: 180 },
    },
    {
      name: 'overlay clamps to the maximum box',
      innerWidth: 2560,
      innerHeight: 2000,
      layout: 'overlay' as const,
      want: { width: 242, height: 242 },
    },
  ])('$name', ({ innerWidth, innerHeight, layout, want }) => {
    expect(mapFrameSize(innerWidth, innerHeight, layout)).toEqual(want);
  });

  it('keeps the overlay map square in both dimensions', () => {
    const frame = mapFrameSize(1440, 800, 'overlay');
    expect(frame.width).toBe(frame.height);
  });
});
