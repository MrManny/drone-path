'use client';

import { useCallback, useReducer, useRef } from 'react';

import type { FrameRange } from 'drone-path-core/frame-range';
import { errorMessage } from 'drone-path-core/errors';
import { appBridge } from '../lib/backend.js';
import type { DialogEvent } from '../lib/dialogstate.js';
import { UI_ERR_REVEAL } from '../lib/errortext.js';
import type { TrackSavePhase } from '../lib/tracksave.js';
import { trackSaveFlow, trackSaveReducer } from '../lib/tracksave.js';
import { useMountedRef } from './useMountedRef.js';

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
  const mountedRef = useMountedRef();
  const savingRef = useRef(false);
  const revealingRef = useRef(false);

  const save = useCallback((): void => {
    if (savingRef.current) return;
    savingRef.current = true;
    void (async () => {
      let opened = false;
      try {
        const event = await trackSaveFlow(
          {
            pickTrackOutput: () => appBridge().pickTrackOutput(),
            saveTrack: (request) => appBridge().saveTrack(request),
          },
          range,
          () => {
            if (!mountedRef.current) return;
            opened = true;
            dispatch({ type: 'started' });
            dispatchDialog({ type: 'openTrackSave' });
            dispatchDialog({ type: 'runStarted' });
          },
          () => mountedRef.current,
        );
        if (!mountedRef.current || event.type === 'canceled') return;
        if (opened) dispatchDialog({ type: 'runFinished' });
        else dispatchDialog({ type: 'openTrackSave' });
        dispatch({ type: 'result', event, scope });
      } finally {
        savingRef.current = false;
      }
    })();
  }, [range, scope, dispatchDialog]);

  const reveal = useCallback((): void => {
    if (phase?.kind !== 'done' || revealingRef.current) return;
    revealingRef.current = true;
    // Every attempt clears the previous failure first, so a successful
    // retry cannot leave a stale error behind.
    dispatch({ type: 'clearError' });
    const done = phase;
    void (async () => {
      try {
        const ack = await appBridge().revealExportOutput({ out: done.path });
        if (!mountedRef.current) return;
        if (!ack.ok) {
          dispatch({ type: 'revealFailed', error: ack.error ?? UI_ERR_REVEAL });
        }
      } catch (e) {
        if (!mountedRef.current) return;
        dispatch({ type: 'revealFailed', error: errorMessage(e) });
      } finally {
        revealingRef.current = false;
      }
    })();
  }, [phase]);

  return { phase, save, reveal };
}
