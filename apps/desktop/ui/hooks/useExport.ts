'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { FrameRange } from 'drone-path-core/frame-range';
import type { RenderConfig } from 'drone-path-engine/config';
import { normalizeDimensions } from 'drone-path-engine/config';
import type { ExportAck } from '../lib/backend.js';
import { appBridge, tryAppBridge } from '../lib/backend.js';
import type { ExportFlowDeps } from '../lib/exportflow.js';
import { cancelExport, chooseAndExport, runDoneAction } from '../lib/exportflow.js';
import type { ExportEvent, ExportState } from '../lib/exportstate.js';
import { exportReducer, initialExportState } from '../lib/exportstate.js';
import type { LoopState } from '../lib/loop.js';
import { frameRangeOf, resolveLoop } from '../lib/loop.js';
import { useMountedRef } from './useMountedRef.js';

type Action =
  | { type: 'open'; width: number; height: number; range: FrameRange | null }
  | { type: 'close' }
  | { type: 'event'; event: ExportEvent };

function reduceExport(state: ExportState | null, action: Action): ExportState | null {
  switch (action.type) {
    case 'open':
      return initialExportState(action.width, action.height, action.range);
    case 'close':
      return null;
    case 'event':
      return state ? exportReducer(state, action.event) : null;
  }
}

function flowDeps(): ExportFlowDeps {
  return {
    pickExportOutput: () => appBridge().pickExportOutput(),
    startExport: (request) => appBridge().startExport(request),
    cancelExport: () => appBridge().cancelExport(),
    revealExportOutput: (payload) => appBridge().revealExportOutput(payload),
    openExportOutput: (payload) => appBridge().openExportOutput(payload),
  };
}

export interface ExportController {
  state: ExportState | null;
  busy: boolean;
  open: (settings: RenderConfig, loop: LoopState, frames: number) => void;
  close: () => void;
  reset: () => void;
  dispatch: (event: ExportEvent) => void;
  start: (settings: RenderConfig, segment: { range: FrameRange } | null) => void;
  cancel: () => void;
  runDone: (call: (deps: ExportFlowDeps) => Promise<ExportAck>) => void;
}

export function useExport(initial: ExportState | null = null): ExportController {
  const [state, dispatchRaw] = useReducer(reduceExport, initial);
  const mountedRef = useMountedRef();
  const sizesRef = useRef<{ width: number; height: number } | null>(null);
  const generationRef = useRef(0);
  const pickingRef = useRef(false);

  useEffect(() => {
    const bridge = tryAppBridge();
    if (!bridge) return;
    const offCapture = bridge.onExportCapture?.((progress) =>
      dispatchRaw({ type: 'event', event: { type: 'capture', progress } }),
    );
    const offDone = bridge.onExportDone?.((outcome) =>
      dispatchRaw({ type: 'event', event: { type: 'finish', outcome } }),
    );
    return () => {
      offCapture?.();
      offDone?.();
    };
  }, []);

  const open = useCallback(
    (settings: RenderConfig, loop: LoopState, frames: number): void => {
      const loopPoints = resolveLoop(loop, frames - 1);
      const width = sizesRef.current?.width ?? settings.width;
      const height = sizesRef.current?.height ?? settings.height;
      generationRef.current += 1;
      pickingRef.current = false;
      dispatchRaw({
        type: 'open',
        width,
        height,
        range: loopPoints ? frameRangeOf(loopPoints) : null,
      });
    },
    [],
  );

  const close = useCallback((): void => {
    generationRef.current += 1;
    pickingRef.current = false;
    dispatchRaw({ type: 'close' });
  }, []);

  const reset = useCallback((): void => {
    sizesRef.current = null;
    generationRef.current += 1;
    pickingRef.current = false;
    dispatchRaw({ type: 'close' });
  }, []);

  const dispatch = useCallback(
    (event: ExportEvent): void => {
      if (state?.phase === 'form' && (event.type === 'setWidth' || event.type === 'setHeight')) {
        sizesRef.current = normalizeDimensions(
          event.type === 'setWidth' ? event.width : state.form.width,
          event.type === 'setHeight' ? event.height : state.form.height,
        );
      }
      dispatchRaw({ type: 'event', event });
    },
    [state],
  );

  const start = useCallback(
    (settings: RenderConfig, segment: { range: FrameRange } | null): void => {
      if (!state || state.phase !== 'form' || pickingRef.current) return;
      pickingRef.current = true;
      const gen = generationRef.current;
      const isActive = (): boolean => mountedRef.current && generationRef.current === gen;
      void chooseAndExport(
        flowDeps(),
        { settings, form: state.form, segment },
        (event) => dispatchRaw({ type: 'event', event }),
        isActive,
      ).finally(() => {
        if (generationRef.current === gen) pickingRef.current = false;
      });
    },
    [state, mountedRef],
  );

  const cancel = useCallback((): void => {
    cancelExport(flowDeps(), (event) => dispatchRaw({ type: 'event', event }));
  }, []);

  const runDone = useCallback((call: (deps: ExportFlowDeps) => Promise<ExportAck>): void => {
    runDoneAction(flowDeps(), call, (event) => dispatchRaw({ type: 'event', event }));
  }, []);

  return {
    state,
    busy: state?.phase === 'running',
    open,
    close,
    reset,
    dispatch,
    start,
    cancel,
    runDone,
  };
}
