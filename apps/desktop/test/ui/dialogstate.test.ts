import { describe, expect, it } from 'vitest';

import { dialogReducer, isPlayerDialog } from '../../ui/lib/dialogstate.js';
import type { DialogEvent, DialogId } from '../../ui/lib/dialogstate.js';

const STATES: DialogId[] = [
  'closed',
  'help',
  'about',
  'map-appearance',
  'settings',
  'export',
  'track-save',
  'update',
];

const EVENTS: DialogEvent[] = [
  { type: 'openHelp' },
  { type: 'openAbout' },
  { type: 'openMapAppearance' },
  { type: 'openSettings' },
  { type: 'openExport' },
  { type: 'openTrackSave' },
  { type: 'updateReady' },
  { type: 'close' },
  { type: 'resetPlayerDialogs' },
];

function expected(state: DialogId, event: DialogEvent, busy: boolean): DialogId {
  const pinned = busy || state === 'update';
  switch (event.type) {
    case 'openHelp':
      return pinned ? state : 'help';
    case 'openAbout':
      return pinned ? state : 'about';
    case 'openSettings':
      return pinned ? state : 'settings';
    case 'openMapAppearance':
      return pinned ? state : 'map-appearance';
    case 'openExport':
      return pinned ? state : 'export';
    case 'openTrackSave':
      return pinned ? state : 'track-save';
    case 'updateReady':
      return state === 'closed' ? 'update' : state;
    case 'close':
      return busy ? state : 'closed';
    case 'resetPlayerDialogs':
      return isPlayerDialog(state) ? 'closed' : state;
  }
}

const TABLE = STATES.flatMap((from) =>
  [false, true].flatMap((busy) =>
    EVENTS.map((event) => ({
      when: event.type,
      from,
      busy,
      event,
      to: expected(from, event, busy),
    })),
  ),
);

describe.each(TABLE)('dialogReducer: $when from $from (busy=$busy)', ({ from, busy, event, to }) => {
  it(`lands on ${to}`, () => {
    expect(dialogReducer(from, event, busy)).toBe(to);
  });
});

describe('isPlayerDialog', () => {
  it('identifies recording-bound modals only', () => {
    expect(isPlayerDialog('export')).toBe(true);
    expect(isPlayerDialog('track-save')).toBe(true);
    expect(isPlayerDialog('closed')).toBe(false);
    expect(isPlayerDialog('help')).toBe(false);
    expect(isPlayerDialog('about')).toBe(false);
    expect(isPlayerDialog('map-appearance')).toBe(false);
    expect(isPlayerDialog('settings')).toBe(false);
    expect(isPlayerDialog('update')).toBe(false);
  });
});

describe('dialog round trips', () => {
  it('pins the active modal while busy and lets close through once idle', () => {
    let state: DialogId = 'closed';
    state = dialogReducer(state, { type: 'openExport' }, false);
    expect(state).toBe('export');
    expect(dialogReducer(state, { type: 'close' }, true)).toBe('export');
    expect(dialogReducer(state, { type: 'openAbout' }, true)).toBe('export');
    expect(dialogReducer(state, { type: 'close' }, false)).toBe('closed');
  });

  it('closes recording-bound dialogs on resetPlayerDialogs even if busy, while keeping app dialogs', () => {
    expect(dialogReducer('track-save', { type: 'resetPlayerDialogs' }, true)).toBe('closed');
    expect(dialogReducer('export', { type: 'resetPlayerDialogs' }, true)).toBe('closed');
    expect(dialogReducer('help', { type: 'resetPlayerDialogs' }, false)).toBe('help');
    expect(dialogReducer('update', { type: 'resetPlayerDialogs' }, true)).toBe('update');
  });

  it('keeps the update prompt pinned against other open requests while allowing close when idle', () => {
    let state: DialogId = 'help';
    state = dialogReducer(state, { type: 'updateReady' }, false);
    expect(state).toBe('help');
    state = dialogReducer(state, { type: 'close' }, false);
    state = dialogReducer(state, { type: 'updateReady' }, false);
    expect(state).toBe('update');
    expect(dialogReducer(state, { type: 'openMapAppearance' }, false)).toBe('update');
    expect(dialogReducer(state, { type: 'close' }, true)).toBe('update');
    expect(dialogReducer(state, { type: 'close' }, false)).toBe('closed');
  });
});
