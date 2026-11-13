import { describe, expect, it } from 'vitest';

import type { PrepareProgress } from '../../src/pipeline.js';
import { prepareNoticeText, preparePercent } from '../../ui/lib/preparetext.js';

function progress(overrides: Partial<PrepareProgress> = {}): PrepareProgress {
  return { stage: 'probe', done: 0, total: 3, ...overrides };
}

describe('prepareNoticeText', () => {
  it.each<{ overrides: Partial<PrepareProgress>; text: string }>([
    { overrides: { stage: 'probe' }, text: 'Reading the recording…' },
    { overrides: { stage: 'telemetry' }, text: 'Loading telemetry…' },
    { overrides: { stage: 'plan' }, text: 'Setting up the map…' },
  ])('names the running stage as "$text"', ({ overrides, text }) => {
    expect(prepareNoticeText(progress(overrides))).toBe(text);
  });

  it('carries no tile warm-up copy', () => {
    for (const stage of ['probe', 'telemetry', 'plan'] as const) {
      expect(prepareNoticeText(progress({ stage }))).not.toMatch(/Warming tiles/);
    }
  });
});

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
  ])('renders $percent% for $name', ({ overrides, percent }) => {
    expect(preparePercent(progress(overrides))).toBe(percent);
  });

  it('renders the raw step ratio for a stage it does not know', () => {
    const unknown = { stage: 'mystery', done: 3, total: 4 } as unknown as PrepareProgress;
    expect(preparePercent(unknown)).toBe(75);
    expect(preparePercent({ ...unknown, done: 5, total: 4 })).toBe(100);
  });

  it('renders 0% when a report carries no steps', () => {
    expect(preparePercent(progress({ done: 0, total: 0 }))).toBe(0);
  });

  it('grows monotonically across the three stage reports', () => {
    const percents = [
      progress({ stage: 'probe', done: 0 }),
      progress({ stage: 'telemetry', done: 1 }),
      progress({ stage: 'plan', done: 2 }),
    ].map((event) => preparePercent(event));
    expect(percents).toEqual([0, 33, 67]);
    expect(percents[0]).toBeLessThan(percents[1]);
    expect(percents[1]).toBeLessThan(percents[2]);
  });
});
