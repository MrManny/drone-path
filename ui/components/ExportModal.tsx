'use client';

import { useEffect, useReducer, useRef } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { EncodeSettings, FrameRange, RenderConfig } from '../../src/config.js';
import { appBridge } from '../lib/backend.js';
import type { DialogEvent } from '../lib/dialogstate.js';
import type { ExportFlowDeps } from '../lib/exportflow.js';
import { cancelExport, chooseAndExport, runDoneAction } from '../lib/exportflow.js';
import {
  captureFraction,
  exportPhaseText,
  exportReducer,
  initialExportState,
  previewFrame,
} from '../lib/exportstate.js';
import { formatFrameRange, formatTime } from '../lib/frametime.js';
import type { LoopState } from '../lib/loop.js';
import { resolveLoop } from '../lib/loop.js';
import { DialogShell } from './DialogShell.js';
import { ExportDone } from './ExportDone.js';
import { ExportError } from './ExportError.js';
import { ExportForm } from './ExportForm.js';
import { ExportPreview } from './ExportPreview.js';
import { ExportRunning } from './ExportRunning.js';

export interface ExportModalProps {
  session: UiSession;
  settings: RenderConfig;
  loop: LoopState;
  onClose: () => void;
  dismissible: boolean;
  dispatchDialog: (event: DialogEvent) => void;
  onEncoderChange: (patch: Partial<EncodeSettings>) => void;
  initialSizes?: { width: number; height: number } | null;
  onSizesChange?: (sizes: { width: number; height: number }) => void;
}

export function ExportModal({
  session,
  settings,
  loop,
  onClose,
  dismissible,
  dispatchDialog,
  onEncoderChange,
  initialSizes = null,
  onSizesChange,
}: ExportModalProps) {
  const { video, durationSec } = session;
  const loopPoints = resolveLoop(loop, video.frames - 1);
  const [state, dispatch] = useReducer(exportReducer, undefined, () =>
    initialExportState(
      initialSizes?.width ?? settings.width,
      initialSizes?.height ?? settings.height,
      loopPoints ? { start: loopPoints.in, end: loopPoints.out } : null,
    ),
  );
  const busy = state.phase === 'running';

  useEffect(() => {
    onSizesChange?.({ width: state.form.width, height: state.form.height });
  }, [state.form.width, state.form.height, onSizesChange]);

  useEffect(() => {
    if (busy) dispatchDialog({ type: 'runStarted' });
    return () => {
      if (busy) dispatchDialog({ type: 'runFinished' });
    };
  }, [busy, dispatchDialog]);

  useEffect(() => {
    let offProgress: (() => void) | null = null;
    let offCapture: (() => void) | null = null;
    let offDone: (() => void) | null = null;
    try {
      const bridge = appBridge();
      offProgress = bridge.onExportProgress((message) =>
        dispatch({ type: 'progress', message }),
      );
      offCapture = bridge.onExportCapture((progress) =>
        dispatch({ type: 'capture', progress }),
      );
      offDone = bridge.onExportDone((outcome) => dispatch({ type: 'finish', outcome }));
    } catch {
      // Outside the app shell there is no backend: the form still renders.
    }
    return () => {
      offProgress?.();
      offCapture?.();
      offDone?.();
    };
  }, []);

  const { phase, form, result, error, canceling } = state;

  // A phase change unmounts the old phase's action; focus follows the flow to
  // the new primary action (or the dialog) so it never lands on <body>.
  const phaseColumnRef = useRef<HTMLDivElement>(null);
  const seenPhase = useRef(phase);
  useEffect(() => {
    if (seenPhase.current === phase) return;
    seenPhase.current = phase;
    const column = phaseColumnRef.current;
    const target = column?.querySelector<HTMLElement>('[data-phase-focus]');
    const fallback = column?.closest('[role="dialog"]') as HTMLElement | null;
    (target ?? fallback)?.focus();
  }, [phase]);

  const showPreview = phase === 'form' || phase === 'running' || phase === 'done';
  const previewConfig = state.request?.config ?? settings;
  const previewRange = state.request ? state.request.range : form.range;
  const totalText = formatTime(durationSec);
  const segment: { range: FrameRange; label: string } | null = loopPoints
    ? {
        range: { start: loopPoints.in, end: loopPoints.out },
        label: formatFrameRange(loopPoints, video.fps),
      }
    : null;

  // Every method resolves the bridge inside the flow's call so an absent
  // backend surfaces as a failure event, never an unhandled throw.
  const flowDeps = (): ExportFlowDeps => ({
    pickExportOutput: () => appBridge().pickExportOutput(),
    startExport: (request) => appBridge().startExport(request),
    cancelExport: () => appBridge().cancelExport(),
    revealExportOutput: (payload) => appBridge().revealExportOutput(payload),
    openExportOutput: (payload) => appBridge().openExportOutput(payload),
  });

  const changeEncoder = (patch: Partial<EncodeSettings>): void => {
    dispatch({ type: 'clearError' });
    onEncoderChange(patch);
  };

  return (
    <DialogShell
      title="Export video"
      panelClass="export-panel"
      onClose={onClose}
      closeOnBackdrop={dismissible}
      blockedReason={dismissible ? undefined : 'Export is running. Cancel it to close.'}
    >
      <div className="export-body">
        {showPreview ? (
          <ExportPreview
            session={session}
            config={previewConfig}
            size={{ width: form.width, height: form.height }}
            frame={previewFrame(previewRange, video.frames)}
            note={phase === 'form'}
          />
        ) : null}
        <div className="export-phase" ref={phaseColumnRef}>
          <p className="phase-status" role="status">
            {exportPhaseText(state)}
          </p>
          {phase === 'form' ? (
            <ExportForm
              form={form}
              segment={segment}
              totalText={totalText}
              encode={{ codec: settings.codec, quality: settings.quality, preset: settings.preset }}
              error={error}
              dispatch={dispatch}
              onEncoderChange={changeEncoder}
              onClose={onClose}
              onStart={() =>
                void chooseAndExport(flowDeps(), { settings, form, segment }, dispatch)
              }
            />
          ) : null}

          {phase === 'running' ? (
            <ExportRunning
              fraction={captureFraction(state.capture)}
              canceling={canceling}
              error={error}
              onCancel={() => cancelExport(flowDeps(), dispatch)}
            />
          ) : null}

          {phase === 'done' && result ? (
            <ExportDone
              result={result}
              error={error}
              onReveal={() =>
                runDoneAction(
                  flowDeps(),
                  (deps) => deps.revealExportOutput({ out: result.out }),
                  dispatch,
                )
              }
              onOpen={() =>
                runDoneAction(
                  flowDeps(),
                  (deps) => deps.openExportOutput({ out: result.out }),
                  dispatch,
                )
              }
            />
          ) : null}

          {phase === 'error' && error ? <ExportError error={error} /> : null}
        </div>
      </div>
    </DialogShell>
  );
}
