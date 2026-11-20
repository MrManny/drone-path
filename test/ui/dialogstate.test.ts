import { describe, expect, it } from 'vitest';

import { canDismiss, dialogReducer } from '../../ui/lib/dialogstate.js';
import type { DialogEvent, DialogState } from '../../ui/lib/dialogstate.js';

const STATES: DialogState[] = [
  'closed',
  'help',
  'about',
  'map-appearance',
  'settings',
  'export-form',
  'export-running',
  'track-save',
  'track-saving',
  'update-prompt',
  'update-restarting',
];

const EVENTS: DialogEvent[] = [
  { type: 'openHelp' },
  { type: 'openAbout' },
  { type: 'openMapAppearance' },
  { type: 'openSettings' },
  { type: 'openExport' },
  { type: 'openTrackSave' },
  { type: 'runStarted' },
  { type: 'runFinished' },
  { type: 'updateReady' },
  { type: 'close' },
];

function busy(state: DialogState): boolean {
  return (
    state === 'export-running' ||
    state === 'track-saving' ||
    state === 'update-restarting'
  );
}

function pinned(state: DialogState): boolean {
  return busy(state) || state === 'update-prompt';
}

function expected(state: DialogState, event: DialogEvent): DialogState {
  switch (event.type) {
    case 'openHelp':
      return pinned(state) ? state : 'help';
    case 'openAbout':
      return pinned(state) ? state : 'about';
    case 'openSettings':
      return pinned(state) ? state : 'settings';
    case 'openMapAppearance':
      return pinned(state) ? state : 'map-appearance';
    case 'openExport':
      return pinned(state) ? state : 'export-form';
    case 'openTrackSave':
      return pinned(state) ? state : 'track-save';
    case 'runStarted':
      return state === 'export-form'
        ? 'export-running'
        : state === 'track-save'
          ? 'track-saving'
          : state === 'update-prompt'
            ? 'update-restarting'
            : state;
    case 'runFinished':
      return state === 'export-running'
        ? 'export-form'
        : state === 'track-saving'
          ? 'track-save'
          : state === 'update-restarting'
            ? 'update-prompt'
            : state;
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

describe.each<DialogState>([
  'closed',
  'help',
  'about',
  'map-appearance',
  'settings',
  'export-form',
  'track-save',
  'update-prompt',
])('canDismiss(%s)', (state) => {
  it('is true, so Escape, the backdrop and the close may dismiss', () => {
    expect(canDismiss(state)).toBe(true);
  });
});

describe.each<DialogState>(['export-running', 'track-saving', 'update-restarting'])(
  'canDismiss(%s)',
  (state) => {
    it('is false, so the running work keeps its dialog on screen', () => {
      expect(canDismiss(state)).toBe(false);
    });
  },
);

describe('the export run round trip', () => {
  it('pins the dialog from start to finish and lets close through afterwards', () => {
    let state: DialogState = 'closed';
    state = dialogReducer(state, { type: 'openExport' });
    expect(canDismiss(state)).toBe(true);
    state = dialogReducer(state, { type: 'runStarted' });
    expect(canDismiss(state)).toBe(false);
    expect(dialogReducer(state, { type: 'close' })).toBe('export-running');
    state = dialogReducer(state, { type: 'runFinished' });
    expect(canDismiss(state)).toBe(true);
    expect(dialogReducer(state, { type: 'close' })).toBe('closed');
  });
});

describe('the telemetry save round trip', () => {
  it('pins the dialog while the write runs, so a late failure can never close into silence', () => {
    let state: DialogState = 'closed';
    state = dialogReducer(state, { type: 'openTrackSave' });
    expect(state).toBe('track-save');
    expect(canDismiss(state)).toBe(true);
    state = dialogReducer(state, { type: 'runStarted' });
    expect(canDismiss(state)).toBe(false);
    expect(dialogReducer(state, { type: 'close' })).toBe('track-saving');
    expect(dialogReducer(state, { type: 'openExport' })).toBe('track-saving');
    state = dialogReducer(state, { type: 'runFinished' });
    expect(canDismiss(state)).toBe(true);
    expect(dialogReducer(state, { type: 'close' })).toBe('closed');
  });
});

describe('the map appearance dialog round trip', () => {
  it('opens over a quiet UI, replaces another dialog and closes like any dialog', () => {
    let state: DialogState = 'closed';
    state = dialogReducer(state, { type: 'openMapAppearance' });
    expect(state).toBe('map-appearance');
    expect(canDismiss(state)).toBe(true);
    expect(dialogReducer(state, { type: 'openAbout' })).toBe('about');
    expect(dialogReducer(state, { type: 'close' })).toBe('closed');
  });

  it('never opens over pinned work', () => {
    expect(dialogReducer('export-running', { type: 'openMapAppearance' })).toBe('export-running');
    expect(dialogReducer('update-prompt', { type: 'openMapAppearance' })).toBe('update-prompt');
  });
});

describe('the update prompt round trip', () => {
  it('waits for a quiet UI, pins during restart, and dismisses once settled', () => {
    let state: DialogState = 'help';
    state = dialogReducer(state, { type: 'updateReady' });
    expect(state).toBe('help');
    state = dialogReducer(state, { type: 'close' });
    state = dialogReducer(state, { type: 'updateReady' });
    expect(state).toBe('update-prompt');
    expect(canDismiss(state)).toBe(true);
    state = dialogReducer(state, { type: 'runStarted' });
    expect(state).toBe('update-restarting');
    expect(canDismiss(state)).toBe(false);
    expect(dialogReducer(state, { type: 'close' })).toBe('update-restarting');
    state = dialogReducer(state, { type: 'runFinished' });
    expect(state).toBe('update-prompt');
    expect(canDismiss(state)).toBe(true);
    expect(dialogReducer(state, { type: 'close' })).toBe('closed');
  });
});
