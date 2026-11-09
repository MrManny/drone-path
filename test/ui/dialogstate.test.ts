import { describe, expect, it } from 'vitest';

import { canDismiss, dialogReducer } from '../../ui/lib/dialogstate.js';
import type { DialogEvent, DialogState } from '../../ui/lib/dialogstate.js';

const STATES: DialogState[] = [
  'closed',
  'help',
  'export-form',
  'export-running',
  'telemetry-save',
  'telemetry-saving',
  'update-prompt',
];

const EVENTS: DialogEvent[] = [
  { type: 'openHelp' },
  { type: 'openExport' },
  { type: 'openTelemetrySave' },
  { type: 'telemetrySaveStarted' },
  { type: 'telemetrySaveFinished' },
  { type: 'exportStarted' },
  { type: 'exportFinished' },
  { type: 'updateReady' },
  { type: 'close' },
];

function busy(state: DialogState): boolean {
  return state === 'export-running' || state === 'telemetry-saving';
}

function pinned(state: DialogState): boolean {
  return busy(state) || state === 'update-prompt';
}

function expected(state: DialogState, event: DialogEvent): DialogState {
  switch (event.type) {
    case 'openHelp':
      return pinned(state) ? state : 'help';
    case 'openExport':
      return pinned(state) ? state : 'export-form';
    case 'openTelemetrySave':
      return pinned(state) ? state : 'telemetry-save';
    case 'telemetrySaveStarted':
      return state === 'telemetry-save' ? 'telemetry-saving' : state;
    case 'telemetrySaveFinished':
      return state === 'telemetry-saving' ? 'telemetry-save' : state;
    case 'exportStarted':
      return state === 'export-form' ? 'export-running' : state;
    case 'exportFinished':
      return state === 'export-running' ? 'export-form' : state;
    case 'updateReady':
      return state === 'closed' ? 'update-prompt' : state;
    case 'close':
      return busy(state) ? state : 'closed';
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

describe.each<DialogState>(['closed', 'help', 'export-form', 'telemetry-save', 'update-prompt'])(
  'canDismiss(%s)',
  (state) => {
    it('is true, so Escape, the backdrop and the close may dismiss', () => {
      expect(canDismiss(state)).toBe(true);
    });
  },
);

describe.each<DialogState>(['export-running', 'telemetry-saving'])('canDismiss(%s)', (state) => {
  it('is false, so the running work keeps its dialog on screen', () => {
    expect(canDismiss(state)).toBe(false);
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

describe('the telemetry save round trip', () => {
  it('pins the dialog while the write runs, so a late failure can never close into silence', () => {
    let state: DialogState = 'closed';
    state = dialogReducer(state, { type: 'openTelemetrySave' });
    expect(state).toBe('telemetry-save');
    expect(canDismiss(state)).toBe(true);
    state = dialogReducer(state, { type: 'telemetrySaveStarted' });
    expect(canDismiss(state)).toBe(false);
    expect(dialogReducer(state, { type: 'close' })).toBe('telemetry-saving');
    expect(dialogReducer(state, { type: 'openExport' })).toBe('telemetry-saving');
    state = dialogReducer(state, { type: 'telemetrySaveFinished' });
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
