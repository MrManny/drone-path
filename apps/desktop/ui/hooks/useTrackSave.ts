'use client';

import { useCallback, useReducer, useRef } from 'react';

import type { FrameRange } from 'drone-path-core/frame-range';
import { errorMessage } from 'drone-path-core/errors';
import { appBridge } from '../lib/backend.js';
import { UI_ERR_REVEAL } from '../lib/errortext.js';
import type { TrackSavePhase } from '../lib/tracksave.js';
import { trackSaveFlow, trackSaveReducer } from '../lib/tracksave.js';
import { useMountedRef } from './useMountedRef.js';

export interface TrackSaveController {
  phase: TrackSavePhase | null;
  busy: boolean;
  save: (range: FrameRange | null, scope: string) => void;
  reveal: () => void;
  reset: () => void;
}

export function useTrackSave(options: { onOpen: () => void }): TrackSaveController {
  const { onOpen } = options;
  const [phase, dispatch] = useReducer(trackSaveReducer, null);
  const mountedRef = useMountedRef();
  const sessionRef = useRef(0);
  const savingRef = useRef(false);
  const revealingRef = useRef(false);

  const reset = useCallback((): void => {
    sessionRef.current += 1;
    savingRef.current = false;
    revealingRef.current = false;
    dispatch({ type: 'reset' });
  }, []);

  const save = useCallback(
    (range: FrameRange | null, scope: string): void => {
      if (savingRef.current) return;
      savingRef.current = true;
      const session = sessionRef.current;
      const isActive = (): boolean => mountedRef.current && sessionRef.current === session;
      void (async () => {
        try {
          const event = await trackSaveFlow(
            {
              pickTrackOutput: () => appBridge().pickTrackOutput(),
              saveTrack: (request) => appBridge().saveTrack(request),
            },
            range,
            () => {
              if (!isActive()) return;
              dispatch({ type: 'started' });
              onOpen();
            },
            isActive,
          );
          if (!isActive() || event.type === 'canceled') return;
          dispatch({ type: 'result', event, scope });
          onOpen();
        } finally {
          if (sessionRef.current === session) savingRef.current = false;
        }
      })();
    },
    [onOpen, mountedRef],
  );

  const reveal = useCallback((): void => {
    if (phase?.kind !== 'done' || revealingRef.current) return;
    revealingRef.current = true;
    const session = sessionRef.current;
    // Every attempt clears the previous failure first, so a successful
    // retry cannot leave a stale error behind.
    dispatch({ type: 'clearError' });
    const done = phase;
    void (async () => {
      try {
        const ack = await appBridge().revealExportOutput({ out: done.path });
        if (!mountedRef.current || sessionRef.current !== session) return;
        if (!ack.ok) {
          dispatch({ type: 'revealFailed', error: ack.error ?? UI_ERR_REVEAL });
        }
      } catch (e) {
        if (!mountedRef.current || sessionRef.current !== session) return;
        dispatch({ type: 'revealFailed', error: errorMessage(e) });
      } finally {
        if (sessionRef.current === session) revealingRef.current = false;
      }
    })();
  }, [phase, mountedRef]);

  return { phase, busy: phase?.kind === 'saving', save, reveal, reset };
}
