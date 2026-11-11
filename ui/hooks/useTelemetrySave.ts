'use client';

import { useCallback, useReducer } from 'react';

import type { FrameRange } from '../../src/config.js';
import { errorMessage } from '../../src/errors.js';
import { appBridge } from '../lib/backend.js';
import type { DialogEvent } from '../lib/dialogstate.js';
import type { TelemetrySavePhase } from '../lib/telemetrysave.js';
import { telemetrySaveFlow, telemetrySaveReducer } from '../lib/telemetrysave.js';

export interface TelemetrySave {
  phase: TelemetrySavePhase | null;
  save: () => void;
  reveal: () => void;
}

// Owns the telemetry-save flow and its dialog choreography: the phase, the
// pinning while the write runs and the open/result sequencing all live here,
// so the workspace chrome only renders the phase.
export function useTelemetrySave(options: {
  range: FrameRange | null;
  scope: string;
  dispatchDialog: (event: DialogEvent) => void;
}): TelemetrySave {
  const { range, scope, dispatchDialog } = options;
  const [phase, dispatch] = useReducer(telemetrySaveReducer, null);

  const save = useCallback((): void => {
    void (async () => {
      let opened = false;
      const event = await telemetrySaveFlow(
        {
          pickTelemetryOutput: () => appBridge().pickTelemetryOutput(),
          saveTelemetryJson: (request) => appBridge().saveTelemetryJson(request),
        },
        range,
        () => {
          opened = true;
          dispatch({ type: 'started' });
          dispatchDialog({ type: 'openTelemetrySave' });
          dispatchDialog({ type: 'runStarted' });
        },
      );
      if (event.type === 'canceled') return;
      if (opened) dispatchDialog({ type: 'runFinished' });
      else dispatchDialog({ type: 'openTelemetrySave' });
      dispatch({ type: 'result', event, scope });
    })();
  }, [range, scope, dispatchDialog]);

  const reveal = useCallback((): void => {
    if (phase?.kind !== 'done') return;
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
