import { describe, expect, it } from 'vitest';

import { canDismiss, dialogReducer } from '../../ui/lib/dialogstate.js';
import type { DialogEvent, DialogState } from '../../ui/lib/dialogstate.js';

const TABLE: Array<{ when: string; from: DialogState; event: DialogEvent; to: DialogState }> = [
  { when: 'openSettings', from: 'closed', event: { type: 'openSettings' }, to: 'settings' },
  { when: 'openSettings', from: 'settings', event: { type: 'openSettings' }, to: 'settings' },
  { when: 'openSettings', from: 'export-form', event: { type: 'openSettings' }, to: 'settings' },
  { when: 'openSettings', from: 'export-running', event: { type: 'openSettings' }, to: 'export-running' },
  { when: 'openExport', from: 'closed', event: { type: 'openExport' }, to: 'export-form' },
  { when: 'openExport', from: 'settings', event: { type: 'openExport' }, to: 'export-form' },
  { when: 'openExport', from: 'export-form', event: { type: 'openExport' }, to: 'export-form' },
  { when: 'openExport', from: 'export-running', event: { type: 'openExport' }, to: 'export-running' },
  { when: 'exportStarted', from: 'closed', event: { type: 'exportStarted' }, to: 'closed' },
  { when: 'exportStarted', from: 'settings', event: { type: 'exportStarted' }, to: 'settings' },
  { when: 'exportStarted', from: 'export-form', event: { type: 'exportStarted' }, to: 'export-running' },
  { when: 'exportStarted', from: 'export-running', event: { type: 'exportStarted' }, to: 'export-running' },
  { when: 'exportFinished', from: 'closed', event: { type: 'exportFinished' }, to: 'closed' },
  { when: 'exportFinished', from: 'settings', event: { type: 'exportFinished' }, to: 'settings' },
  { when: 'exportFinished', from: 'export-form', event: { type: 'exportFinished' }, to: 'export-form' },
  { when: 'exportFinished', from: 'export-running', event: { type: 'exportFinished' }, to: 'export-form' },
  { when: 'exportFinished', from: 'update-prompt', event: { type: 'exportFinished' }, to: 'update-prompt' },
  { when: 'updateReady', from: 'closed', event: { type: 'updateReady' }, to: 'update-prompt' },
  { when: 'updateReady', from: 'settings', event: { type: 'updateReady' }, to: 'settings' },
  { when: 'updateReady', from: 'export-form', event: { type: 'updateReady' }, to: 'export-form' },
  { when: 'updateReady', from: 'export-running', event: { type: 'updateReady' }, to: 'export-running' },
  { when: 'updateReady', from: 'update-prompt', event: { type: 'updateReady' }, to: 'update-prompt' },
  { when: 'openSettings', from: 'update-prompt', event: { type: 'openSettings' }, to: 'update-prompt' },
  { when: 'openExport', from: 'update-prompt', event: { type: 'openExport' }, to: 'update-prompt' },
  { when: 'exportStarted', from: 'update-prompt', event: { type: 'exportStarted' }, to: 'update-prompt' },
  { when: 'close', from: 'update-prompt', event: { type: 'close' }, to: 'closed' },
  { when: 'close', from: 'closed', event: { type: 'close' }, to: 'closed' },
  { when: 'close', from: 'settings', event: { type: 'close' }, to: 'closed' },
  { when: 'close', from: 'export-form', event: { type: 'close' }, to: 'closed' },
  { when: 'close', from: 'export-running', event: { type: 'close' }, to: 'export-running' },
];

describe.each(TABLE)('dialogReducer: $when from $from', ({ from, event, to }) => {
  it(`lands on ${to}`, () => {
    expect(dialogReducer(from, event)).toBe(to);
  });
});

describe.each<DialogState>(['closed', 'settings', 'export-form', 'update-prompt'])(
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
    let state: DialogState = 'settings';
    state = dialogReducer(state, { type: 'updateReady' });
    expect(state).toBe('settings');
    state = dialogReducer(state, { type: 'close' });
    state = dialogReducer(state, { type: 'updateReady' });
    expect(state).toBe('update-prompt');
    expect(canDismiss(state)).toBe(true);
    expect(dialogReducer(state, { type: 'close' })).toBe('closed');
  });
});
