import { describe, expect, it, vi } from 'vitest';

import type { StructuredError } from '../../shared/errors.js';
import type { TrackSaveRequest } from '../../shared/ipc.js';
import type { ExportAck, PickOutputResult } from '../../ui/lib/backend.js';
import {
  trackPhaseText,
  trackSaveFlow,
  trackSaveReducer,
  trackScope,
} from '../../ui/lib/tracksave.js';

const RANGE = { start: 120, end: 300 };

function deps(overrides: {
  pickTrackOutput?: () => Promise<PickOutputResult>;
  saveTrack?: (request: TrackSaveRequest) => Promise<ExportAck>;
} = {}) {
  return {
    pickTrackOutput:
      overrides.pickTrackOutput ?? vi.fn(async (): Promise<PickOutputResult> => ({ ok: true, path: '/exports/flight.telemetry.json' })),
    saveTrack:
      overrides.saveTrack ?? vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
  };
}

describe('trackSaveFlow', () => {
  it('picks a destination, saves the range and reports the written path', async () => {
    const d = deps();
    const onSaving = vi.fn();
    const event = await trackSaveFlow(d, RANGE, onSaving);

    expect(event).toEqual({ type: 'saved', path: '/exports/flight.telemetry.json' });
    expect(onSaving).toHaveBeenCalledTimes(1);
    expect(d.saveTrack).toHaveBeenCalledWith({
      outPath: '/exports/flight.telemetry.json',
      range: RANGE,
    });
  });

  it('passes the full recording as a null range', async () => {
    const d = deps();
    await trackSaveFlow(d, null, vi.fn());
    expect(d.saveTrack).toHaveBeenCalledWith({
      outPath: '/exports/flight.telemetry.json',
      range: null,
    });
  });

  it('reports a canceled save dialog without saving anything', async () => {
    const d = deps({
      pickTrackOutput: vi.fn(async (): Promise<PickOutputResult> => ({
        ok: false,
        canceled: true,
      })),
    });
    const onSaving = vi.fn();
    const event = await trackSaveFlow(d, RANGE, onSaving);

    expect(event).toEqual({ type: 'canceled' });
    expect(d.saveTrack).not.toHaveBeenCalled();
    expect(onSaving).not.toHaveBeenCalled();
  });

  it('aborts before saving when unmounted during the save dialog', async () => {
    let mounted = true;
    const d = deps({
      pickTrackOutput: vi.fn(async (): Promise<PickOutputResult> => {
        mounted = false;
        return { ok: true, path: '/exports/flight.telemetry.json' };
      }),
    });
    const onSaving = vi.fn();
    const event = await trackSaveFlow(d, RANGE, onSaving, () => mounted);

    expect(event).toEqual({ type: 'canceled' });
    expect(onSaving).not.toHaveBeenCalled();
    expect(d.saveTrack).not.toHaveBeenCalled();
  });
});

describe.each<{
  what: string;
  pickTrackOutput: () => Promise<PickOutputResult>;
  error: StructuredError;
}>([
  {
    what: 'the picker reports an error',
    pickTrackOutput: async () => ({ ok: false, code: 'NO_RECORDING', detail: 'no recording loaded' }),
    error: { code: 'NO_RECORDING', detail: 'no recording loaded' },
  },
  {
    what: 'the picker fails without a code',
    pickTrackOutput: async () => ({ ok: false } as PickOutputResult),
    error: { code: 'UNKNOWN' },
  },
  {
    what: 'the picker confirms without a path',
    pickTrackOutput: async () => ({ ok: true } as PickOutputResult),
    error: { code: 'UNKNOWN' },
  },
  {
    what: 'the picker throws',
    pickTrackOutput: async () => {
      throw new Error('the dialog went away');
    },
    error: { code: 'BACKEND_ERROR', detail: 'the dialog went away' },
  },
])('when $what', ({ pickTrackOutput, error }) => {
  it('returns the failure and never reaches the save', async () => {
    const saveTrack = vi.fn(async (): Promise<ExportAck> => ({ ok: true }));
    const onSaving = vi.fn();
    const event = await trackSaveFlow(
      { pickTrackOutput, saveTrack },
      null,
      onSaving,
    );
    expect(event).toEqual({ type: 'failed', error });
    expect(saveTrack).not.toHaveBeenCalled();
    expect(onSaving).not.toHaveBeenCalled();
  });
});

describe.each<{
  what: string;
  saveTrack: (request: TrackSaveRequest) => Promise<ExportAck>;
  error: StructuredError;
}>([
  {
    what: 'the save is refused',
    saveTrack: async () => ({ ok: false, code: 'FS_DISK_FULL', detail: 'disk full' }),
    error: { code: 'FS_DISK_FULL', detail: 'disk full' },
  },
  {
    what: 'the save is refused without a code',
    saveTrack: async () => ({ ok: false } as ExportAck),
    error: { code: 'TRACK_SAVE_FAILED' },
  },
  {
    what: 'the save throws',
    saveTrack: async () => {
      throw new Error('the write went away');
    },
    error: { code: 'BACKEND_ERROR', detail: 'the write went away' },
  },
])('when $what', ({ saveTrack, error }) => {
  it('opens the dialog on the pick confirm and reports the failure', async () => {
    const onSaving = vi.fn();
    const event = await trackSaveFlow(
      { pickTrackOutput: async () => ({ ok: true, path: '/exports/a.json' }), saveTrack },
      null,
      onSaving,
    );
    expect(event).toEqual({ type: 'failed', error });
    expect(onSaving).toHaveBeenCalledTimes(1);
  });
});

describe('trackSaveReducer', () => {
  const SAVING = { kind: 'saving' } as const;
  const DONE = { kind: 'done', path: '/exports/a.json', scope: 'full recording (0:10)' } as const;
  const DISK_FULL: StructuredError = { code: 'FS_DISK_FULL', detail: 'disk full' };
  const REVEAL_ERR: StructuredError = { code: 'REVEAL_FAILED', detail: 'the file could not be revealed' };
  const MISSING_DIR: StructuredError = { code: 'FS_NOT_FOUND', detail: 'the folder is missing' };
  const GONE_DIR: StructuredError = { code: 'FS_NOT_FOUND', detail: 'the folder went away' };

  it('enters the saving phase when the write starts', () => {
    expect(trackSaveReducer(null, { type: 'started' })).toEqual(SAVING);
  });

  it('lands on done with the path and scope when the save succeeds', () => {
    const state = trackSaveReducer(SAVING, {
      type: 'result',
      event: { type: 'saved', path: '/exports/a.json' },
      scope: 'full recording (0:10)',
    });
    expect(state).toEqual(DONE);
  });

  it('lands on error with the structured error when the save fails', () => {
    const state = trackSaveReducer(SAVING, {
      type: 'result',
      event: { type: 'failed', error: DISK_FULL },
      scope: 'full recording (0:10)',
    });
    expect(state).toEqual({ kind: 'error', error: DISK_FULL });
  });

  it('keeps the phase when the pick was canceled', () => {
    const state = trackSaveReducer(SAVING, {
      type: 'result',
      event: { type: 'canceled' },
      scope: 'full recording (0:10)',
    });
    expect(state).toBe(SAVING);
  });

  it('adds the reveal failure to a done phase', () => {
    const state = trackSaveReducer(DONE, {
      type: 'revealFailed',
      error: REVEAL_ERR,
    });
    expect(state).toEqual({ ...DONE, error: REVEAL_ERR });
  });

  it.each([
    ['no phase', null],
    ['the saving phase', SAVING],
    ['the error phase', { kind: 'error', error: DISK_FULL } as const],
  ] as const)('ignores a reveal failure in %s', (_what, state) => {
    expect(trackSaveReducer(state, { type: 'revealFailed', error: { code: 'BACKEND_ERROR', detail: 'nope' } })).toBe(state);
  });

  it('drops a stale reveal failure when the retry clears it (#286)', () => {
    const failed = trackSaveReducer(DONE, {
      type: 'revealFailed',
      error: MISSING_DIR,
    });
    expect(trackSaveReducer(failed, { type: 'clearError' })).toStrictEqual(DONE);
  });

  it('shows only the new failure when a cleared retry fails again', () => {
    const cleared = trackSaveReducer(
      trackSaveReducer(DONE, { type: 'revealFailed', error: MISSING_DIR }),
      { type: 'clearError' },
    );
    expect(trackSaveReducer(cleared, { type: 'revealFailed', error: GONE_DIR })).toEqual({
      ...DONE,
      error: GONE_DIR,
    });
  });

  it.each([
    ['no phase', null],
    ['the saving phase', SAVING],
    ['the error phase', { kind: 'error', error: DISK_FULL } as const],
    ['a clean done phase', DONE],
  ] as const)('ignores a clear in %s, which carries no reveal error to drop', (_what, state) => {
    expect(trackSaveReducer(state, { type: 'clearError' })).toBe(state);
  });
});

describe('trackScope', () => {
  it('names the full recording without a loop', () => {
    expect(trackScope(null, 30, 10)).toBe('full recording (0:10)');
  });

  it('names the In-Out segment with its frames', () => {
    expect(trackScope(RANGE, 30, 10)).toBe('In–Out segment (0:04–0:10 · 181 frames)');
  });
});

describe('trackPhaseText', () => {
  it('reads the saving phase', () => {
    expect(trackPhaseText({ kind: 'saving' })).toBe('Exporting telemetry…');
  });

  it('leads the done phase with the success sentence', () => {
    expect(
      trackPhaseText({ kind: 'done', path: '/exports/a.json', scope: 'full recording (0:10)' }),
    ).toBe('Telemetry exported.');
  });

  it('stays empty in the error phase, which announces through its alert', () => {
    expect(trackPhaseText({ kind: 'error', error: { code: 'FS_DISK_FULL', detail: 'disk full' } })).toBe('');
  });
});
