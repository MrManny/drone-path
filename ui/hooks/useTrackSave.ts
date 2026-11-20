'use client';

import { useCallback, useReducer } from 'react';

import type { FrameRange } from '../../src/frame-range.js';
import { errorMessage } from '../../src/errors.js';
import { appBridge } from '../lib/backend.js';
import type { DialogEvent } from '../lib/dialogstate.js';
import type { TrackSavePhase } from '../lib/tracksave.js';
import { trackSaveFlow, trackSaveReducer } from '../lib/tracksave.js';

interface TrackSave {
  phase: TrackSavePhase | null;
  save: () => void;
  reveal: () => void;
}

export function useTrackSave(options: {
  range: FrameRange | null;
  scope: string;
  dispatchDialog: (event: DialogEvent) => void;
}): TrackSave {
  const { range, scope, dispatchDialog } = options;
  const [phase, dispatch] = useReducer(trackSaveReducer, null);

  const save = useCallback((): void => {
    void (async () => {
      let opened = false;
      const event = await trackSaveFlow(
        {
          pickTrackOutput: () => appBridge().pickTrackOutput(),
          saveTrack: (request) => appBridge().saveTrack(request),
        },
        range,
        () => {
          opened = true;
          dispatch({ type: 'started' });
          dispatchDialog({ type: 'openTrackSave' });
          dispatchDialog({ type: 'runStarted' });
        },
      );
      if (event.type === 'canceled') return;
      if (opened) dispatchDialog({ type: 'runFinished' });
      else dispatchDialog({ type: 'openTrackSave' });
      dispatch({ type: 'result', event, scope });
    })();
  }, [range, scope, dispatchDialog]);

  const reveal = useCallback((): void => {
    if (phase?.kind !== 'done') return;
    // Every attempt clears the previous failure first, so a successful
    // retry cannot leave a stale error behind.
    dispatch({ type: 'clearError' });
    const done = phase;
    void (async () => {
      try {
        const ack = await appBridge().revealExportOutput({ out: done.path });
        if (!ack.ok) {
          dispatch({ type: 'revealFailed', error: ack.error ?? 'the file could not be revealed' });
        }
      } catch (e) {
        dispatch({ type: 'revealFailed', error: errorMessage(e) });
      }
    })();
  }, [phase]);

  return { phase, save, reveal };
}
