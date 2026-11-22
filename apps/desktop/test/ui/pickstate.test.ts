import { describe, expect, it } from 'vitest';

import { INITIAL_PREPARE_PROGRESS } from 'drone-path-engine/plan';
import type { PrepareProgress } from 'drone-path-engine/plan';
import { pickReducer } from '../../ui/lib/pickstate.js';
import type { PickState } from '../../ui/lib/pickstate.js';

const PREPARING: PickState = { kind: 'preparing', progress: INITIAL_PREPARE_PROGRESS };

const PLANNING: PrepareProgress = {
  stage: 'plan',
  done: 2,
  total: 3,
};

describe('pickReducer', () => {
  it('moves to picking while the native dialog is open', () => {
    expect(pickReducer({ kind: 'idle' }, { type: 'pick' })).toEqual({ kind: 'picking' });
  });

  it('starts preparing at the first step only when the backend reports a valid file', () => {
    expect(pickReducer({ kind: 'picking' }, { type: 'preparing' })).toEqual(PREPARING);
  });

  it('follows the reported preparation progress', () => {
    expect(pickReducer(PREPARING, { type: 'progress', progress: PLANNING })).toEqual({
      kind: 'preparing',
      progress: PLANNING,
    });
  });

  it('moves to ready when the recording is loaded', () => {
    expect(pickReducer(PREPARING, { type: 'picked' })).toEqual({ kind: 'ready' });
  });

  it('records the cancel', () => {
    expect(pickReducer({ kind: 'picking' }, { type: 'canceled' })).toEqual({ kind: 'canceled' });
  });

  it('carries the failure error', () => {
    const error = { code: 'UNKNOWN', detail: 'boom' } as const;
    const next = pickReducer(PREPARING, { type: 'failed', error });
    expect(next).toEqual({ kind: 'error', error });
    expect((next as Extract<PickState, { kind: 'error' }>).error).toEqual(error);
  });

  it('starts a new pick after a failure', () => {
    expect(pickReducer({ kind: 'error', error: { code: 'UNKNOWN', detail: 'boom' } }, { type: 'pick' })).toEqual({ kind: 'picking' });
  });

  it.for<PickState>([{ kind: 'error', error: { code: 'UNKNOWN', detail: 'boom' } }, { kind: 'canceled' }])(
    'dismisses the $kind notice back to idle',
    (state) => {
      expect(pickReducer(state, { type: 'dismiss' })).toEqual({ kind: 'idle' });
    },
  );
});
describe.each<PickState>([{ kind: 'picking' }, PREPARING])('a second pick while $kind', (state) => {
  it('is ignored, so one Open never starts two dialogs', () => {
    expect(pickReducer(state, { type: 'pick' })).toBe(state);
  });
});

describe.each<PickState>([
  { kind: 'idle' },
  { kind: 'ready' },
  { kind: 'canceled' },
  { kind: 'error', error: { code: 'UNKNOWN', detail: 'boom' } },
])('a preparing signal from $kind', (state) => {
  it('does not start preparing without an open pick, so no busy status appears early', () => {
    expect(pickReducer(state, { type: 'preparing' })).toBe(state);
  });
});

describe.each<PickState>([
  { kind: 'idle' },
  { kind: 'picking' },
  { kind: 'ready' },
  { kind: 'canceled' },
  { kind: 'error', error: { code: 'UNKNOWN', detail: 'boom' } },
])('a progress report from $kind', (state) => {
  it('is ignored: only an open preparation tracks progress', () => {
    expect(pickReducer(state, { type: 'progress', progress: PLANNING })).toBe(state);
  });
});

describe.each<PickState>([
  { kind: 'idle' },
  { kind: 'picking' },
  PREPARING,
  { kind: 'ready' },
])('dismiss from $kind', (state) => {
  it('leaves the state unchanged: only transient notices can be dismissed', () => {
    expect(pickReducer(state, { type: 'dismiss' })).toBe(state);
  });
});
