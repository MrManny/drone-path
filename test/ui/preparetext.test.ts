import { describe, expect, it } from 'vitest';

import type { PrepareProgress } from '../../src/run.js';
import { prepareNoticeText, preparePercent, tilesWarmingText } from '../../ui/lib/preparetext.js';

function progress(overrides: Partial<PrepareProgress> = {}): PrepareProgress {
  return { stage: 'probe', done: 0, total: 3, tilesDone: 0, tilesTotal: 0, ...overrides };
}

describe('tilesWarmingText', () => {
  it('counts the tiles the same way for the notice and the player hint', () => {
    expect(tilesWarmingText(7, 9)).toBe('Warming tiles… 7/9');
    expect(tilesWarmingText(12, 48)).toBe('Warming tiles… 12/48');
  });
});

describe('prepareNoticeText', () => {
  it.each<{ overrides: Partial<PrepareProgress>; text: string }>([
    { overrides: { stage: 'probe' }, text: 'Probing the recording…' },
    { overrides: { stage: 'telemetry' }, text: 'Loading telemetry…' },
    { overrides: { stage: 'plan' }, text: 'Planning the view…' },
    { overrides: { stage: 'tiles', tilesDone: 12, tilesTotal: 48 }, text: 'Warming tiles… 12/48' },
    { overrides: { stage: 'tiles', tilesDone: 0, tilesTotal: 48 }, text: 'Warming tiles… 0/48' },
  ])('names the running stage as "$text"', ({ overrides, text }) => {
    expect(prepareNoticeText(progress(overrides))).toBe(text);
  });
});

// The event shapes the reporter emits (pinned in test/run.test.ts): one event
// per stage start and one per settled tile. The late stream reveals the tile
// count the way the wire does today — the early stream carries the final
// totals from the first event.
function lateRevealStream(tiles: number): PrepareProgress[] {
  const events: PrepareProgress[] = [
    progress({ stage: 'probe', done: 0 }),
    progress({ stage: 'telemetry', done: 1 }),
    progress({ stage: 'plan', done: 2 }),
    progress({
      stage: 'tiles',
      done: 3,
      total: 3 + tiles,
      tilesDone: 0,
      tilesTotal: tiles,
    }),
  ];
  for (let i = 1; i <= tiles; i++) {
    events.push(
      progress({
        stage: 'tiles',
        done: 3 + i,
        total: 3 + tiles,
        tilesDone: i,
        tilesTotal: tiles,
      }),
    );
  }
  return events;
}

function earlyRevealStream(tiles: number): PrepareProgress[] {
  return lateRevealStream(tiles).map((event) => ({
    ...event,
    total: 3 + tiles,
    tilesTotal: tiles,
  }));
}

function percentsOf(events: PrepareProgress[]): number[] {
  return events.map((event) => preparePercent(event));
}

function expectMonotoneTo100(percents: number[]): void {
  let previous = -Infinity;
  for (const percent of percents) {
    expect(percent).toBeGreaterThanOrEqual(previous);
    previous = percent;
  }
  expect(percents[0]).toBe(0);
  expect(percents[percents.length - 1]).toBe(100);
}

// The IPC boundary is untyped at runtime, so a stage this mapping does not
// know can still arrive; the fallback must keep the bar bounded.
function untypedStageEvent(stage: string, done: number, total: number): PrepareProgress {
  return { stage, done, total, tilesDone: 0, tilesTotal: 0 } as PrepareProgress;
}

describe('preparePercent', () => {
  it.each<{ name: string; overrides: Partial<PrepareProgress>; percent: number }>([
    {
      name: 'the probe checkpoint',
      overrides: { stage: 'probe', done: 0, total: 3 },
      percent: 0,
    },
    {
      name: 'the telemetry checkpoint',
      overrides: { stage: 'telemetry', done: 1, total: 3 },
      percent: 33,
    },
    {
      name: 'the plan checkpoint',
      overrides: { stage: 'plan', done: 2, total: 3 },
      percent: 67,
    },
    {
      name: 'the pre-warm start',
      overrides: { stage: 'tiles', done: 3, total: 51, tilesDone: 0, tilesTotal: 48 },
      percent: 67,
    },
    {
      name: 'a quarter of the tiles',
      overrides: { stage: 'tiles', done: 15, total: 51, tilesDone: 12, tilesTotal: 48 },
      percent: 75,
    },
    {
      name: 'the settled last tile',
      overrides: { stage: 'tiles', done: 51, total: 51, tilesDone: 48, tilesTotal: 48 },
      percent: 100,
    },
    {
      name: 'a plan without tiles to warm',
      overrides: { stage: 'tiles', done: 3, total: 3, tilesDone: 0, tilesTotal: 0 },
      percent: 100,
    },
    {
      name: 'a tile count that overshoots on the wire',
      overrides: { stage: 'tiles', done: 60, total: 51, tilesDone: 57, tilesTotal: 48 },
      percent: 100,
    },
  ])('renders $percent% for $name', ({ overrides, percent }) => {
    expect(preparePercent(progress(overrides))).toBe(percent);
  });

  it('falls back to the raw step ratio for a stage it does not know', () => {
    expect(preparePercent(untypedStageEvent('mystery', 3, 4))).toBe(75);
  });

  it('renders 0% when an unknown stage reports no steps', () => {
    expect(preparePercent(untypedStageEvent('mystery', 0, 0))).toBe(0);
  });

  it('holds the checkpoints where the raw ratio used to shrink', () => {
    // The regression: the pre-warm start read 3/84 ≈ 4% and the bar visibly
    // fell back from the plan checkpoint.
    expect(percentsOf(lateRevealStream(81)).slice(0, 4)).toEqual([0, 33, 67, 67]);
  });
});

describe.each([0, 1, 48, 81])('a preparation with %i tiles', (tiles) => {
  it('grows monotonically to 100% when the plan reveals the tile count late', () => {
    expectMonotoneTo100(percentsOf(lateRevealStream(tiles)));
  });

  it('grows monotonically to 100% when the tile count is final from the first event', () => {
    expectMonotoneTo100(percentsOf(earlyRevealStream(tiles)));
  });
});

describe('preparations that interleave', () => {
  it('keeps each preparation monotone while the other streams through', () => {
    const first = lateRevealStream(81);
    const second = lateRevealStream(2);
    // The second preparation's stage events carry tile total 0 in the middle
    // of the first's pre-warm.
    const merged: Array<{ from: 'first' | 'second'; event: PrepareProgress }> = [
      ...first.slice(0, 6).map((event) => ({ from: 'first' as const, event })),
      ...second.map((event) => ({ from: 'second' as const, event })),
      ...first.slice(6).map((event) => ({ from: 'first' as const, event })),
    ];
    for (const from of ['first', 'second'] as const) {
      expectMonotoneTo100(
        percentsOf(merged.filter((entry) => entry.from === from).map((entry) => entry.event)),
      );
    }
  });

  it('restarts at 0% when a new preparation follows a finished one', () => {
    const finished = percentsOf(lateRevealStream(81));
    const fresh = percentsOf(earlyRevealStream(48));
    expectMonotoneTo100(finished);
    expectMonotoneTo100(fresh);
    expect(fresh[0]).toBe(0);
  });
});
