'use client';

import { useTranslation } from '../lib/i18n.js';
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
import { canceledSentence } from '../lib/errortext.js';
import { formatFrameRange, formatTime } from '../lib/frametime.js';
import type { LoopState } from '../lib/loop.js';
import { frameRangeOf, resolveLoop } from '../lib/loop.js';
import { DialogShell } from './DialogShell.js';
import { ExportDone } from './ExportDone.js';
import { ExportForm } from './ExportForm.js';
import { ExportPreview } from './ExportPreview.js';
import { ExportRunning } from './ExportRunning.js';

interface ExportModalProps {
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
  const t = useTranslation();
  const { video, durationSec } = session;
  const loopPoints = resolveLoop(loop, video.frames - 1);
  const [state, dispatch] = useReducer(exportReducer, undefined, () =>
    initialExportState(
      initialSizes?.width ?? settings.width,
      initialSizes?.height ?? settings.height,
      loopPoints ? frameRangeOf(loopPoints) : null,
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
    let offCapture: (() => void) | null = null;
    let offDone: (() => void) | null = null;
    try {
      const bridge = appBridge();
      offCapture = bridge.onExportCapture((progress) =>
        dispatch({ type: 'capture', progress }),
      );
      offDone = bridge.onExportDone((outcome) => dispatch({ type: 'finish', outcome }));
    } catch {
      // Outside the app shell there is no backend: the form still renders.
    }
    return () => {
      offCapture?.();
      offDone?.();
    };
  }, []);

  const { phase, form, result, error, notice, canceling } = state;

  // A phase change unmounts the old phase's action; focus follows the flow to
  // the new primary action (or the dialog) so it never lands on <body>.
  const actionsRef = useRef<HTMLDivElement>(null);
  const seenPhase = useRef(phase);
  useEffect(() => {
    if (seenPhase.current === phase) return;
    seenPhase.current = phase;
    const actions = actionsRef.current;
    const target = actions?.querySelector<HTMLElement>('[data-phase-focus]');
    const fallback = actions?.closest('[role="dialog"]') as HTMLElement | null;
    (target ?? fallback)?.focus();
  }, [phase]);

  const previewConfig = state.request?.config ?? settings;
  const previewRange = state.request ? state.request.range : form.range;
  const totalText = formatTime(durationSec);
  const segment: { range: FrameRange; label: string } | null = loopPoints
    ? {
        range: frameRangeOf(loopPoints),
        label: formatFrameRange(loopPoints, video.fps, t),
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
      title={t('exportModal.exportVideo')}
      panelClass="export-panel"
      onClose={onClose}
      closeOnBackdrop={dismissible}
      blockedReason={dismissible ? undefined : t('exportModal.busyClose')}
    >
      <div className="export-body">
        <ExportPreview
          session={session}
          config={previewConfig}
          size={{ width: form.width, height: form.height }}
          frame={previewFrame(previewRange, video.frames)}
          note={phase === 'form'}
        />
        <div className="export-phase">
          <p className="phase-status" role="status">
            {exportPhaseText(state, t)}
          </p>
          {phase === 'form' ? (
            <ExportForm
              form={form}
              segment={segment}
              totalText={totalText}
              encode={{ codec: settings.codec, quality: settings.quality, preset: settings.preset }}
              error={error}
              notice={notice ? canceledSentence(t) : null}
              dispatch={dispatch}
              onEncoderChange={changeEncoder}
            />
          ) : null}

          {phase === 'running' ? (
            <ExportRunning fraction={captureFraction(state.capture)} error={error} />
          ) : null}

          {phase === 'done' && result ? <ExportDone result={result} error={error} /> : null}
        </div>
      </div>
      <div className="dialog-actions" ref={actionsRef}>
        {phase === 'form' ? (
          <>
            <button type="button" onClick={onClose}>
              {t('exportModal.cancel')}
            </button>
            <button
              type="button"
              className="dialog-primary"
              data-phase-focus
              onClick={() => void chooseAndExport(flowDeps(), { settings, form, segment }, dispatch)}
            >
              {t('exportModal.startExport')}
            </button>
          </>
        ) : null}
        {phase === 'running' ? (
          <button
            type="button"
            data-phase-focus
            disabled={canceling}
            onClick={() => cancelExport(flowDeps(), dispatch)}
          >
            {t('exportModal.cancelExport')}
          </button>
        ) : null}
        {phase === 'done' && result ? (
          <>
            <button
              type="button"
              onClick={() =>
                runDoneAction(
                  flowDeps(),
                  (deps) => deps.openExportOutput({ out: result.out }),
                  dispatch,
                )
              }
            >
              {t('exportModal.openVideo')}
            </button>
            <button
              type="button"
              className="dialog-primary"
              data-phase-focus
              onClick={() =>
                runDoneAction(
                  flowDeps(),
                  (deps) => deps.revealExportOutput({ out: result.out }),
                  dispatch,
                )
              }
            >
              {t('exportModal.revealInFolder')}
            </button>
          </>
        ) : null}
      </div>
    </DialogShell>
  );
}
