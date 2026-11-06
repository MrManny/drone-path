import { describe, expect, it } from 'vitest';

import { canDismiss, dialogReducer } from '../../ui/lib/dialogstate.js';
import type { DialogEvent, DialogState } from '../../ui/lib/dialogstate.js';

const STATES: DialogState[] = ['closed', 'help', 'export-form', 'export-running', 'update-prompt'];

const EVENTS: DialogEvent[] = [
  { type: 'openHelp' },
  { type: 'openExport' },
  { type: 'exportStarted' },
  { type: 'exportFinished' },
  { type: 'updateReady' },
  { type: 'close' },
];

// The full transition table: one row per state and event, derived from the
// machine's three rules (open is refused over a running export or the update
// prompt, updateReady needs a quiet UI, close is refused while running).
function expected(state: DialogState, event: DialogEvent): DialogState {
  const pinned = state === 'export-running' || state === 'update-prompt';
  switch (event.type) {
    case 'openHelp':
      return pinned ? state : 'help';
    case 'openExport':
      return pinned ? state : 'export-form';
    case 'exportStarted':
      return state === 'export-form' ? 'export-running' : state;
    case 'exportFinished':
      return state === 'export-running' ? 'export-form' : state;
    case 'updateReady':
      return state === 'closed' ? 'update-prompt' : state;
    case 'close':
      return state === 'export-running' ? state : 'closed';
  }
}

const TABLE = STATES.flatMap((from) =>
  EVENTS.map((event) => ({ when: event.type, from, event, to: expected(from, event) })),
);

describe.each(TABLE)('dialogReducer: $when from $from', ({ from, event, to }) => {
  it(`lands on ${to}`, () => {
    expect(dialogReducer(from, event)).toBe(to);
  });
});

describe.each<DialogState>(['closed', 'help', 'export-form', 'update-prompt'])(
  'canDismiss(%s)',
  (state) => {
    it('is true, so Escape, the backdrop and the close may dismiss', () => {
      expect(canDismiss(state)).toBe(true);
    });
  },
);

describe('canDismiss(export-running)', () => {
  it('is false, so the running job keeps its dialog on screen', () => {
    expect(canDismiss('export-running')).toBe(false);
  });
});

describe('the export run round trip', () => {
  it('pins the dialog from start to finish and lets close through afterwards', () => {
    let state: DialogState = 'closed';
    state = dialogReducer(state, { type: 'openExport' });
    expect(canDismiss(state)).toBe(true);
    state = dialogReducer(state, { type: 'exportStarted' });
    expect(canDismiss(state)).toBe(false);
    expect(dialogReducer(state, { type: 'close' })).toBe('export-running');
    state = dialogReducer(state, { type: 'exportFinished' });
    expect(canDismiss(state)).toBe(true);
    expect(dialogReducer(state, { type: 'close' })).toBe('closed');
  });
});

describe('the update prompt round trip', () => {
  it('waits for a quiet UI and then dismisses like any dialog', () => {
    let state: DialogState = 'help';
    state = dialogReducer(state, { type: 'updateReady' });
    expect(state).toBe('help');
    state = dialogReducer(state, { type: 'close' });
    state = dialogReducer(state, { type: 'updateReady' });
    expect(state).toBe('update-prompt');
    expect(canDismiss(state)).toBe(true);
    expect(dialogReducer(state, { type: 'close' })).toBe('closed');
  });
});
