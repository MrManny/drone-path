'use client';

import { useEffect, useReducer } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { EncodeSettings, ExportRequest, FrameRange, RenderConfig } from '../../src/config.js';
import { errorMessage } from '../../src/errors.js';
import type { AppBridge, ExportAck } from '../lib/backend.js';
import { appBridge } from '../lib/backend.js';
import type { DialogEvent } from '../lib/dialogstate.js';
import type { ExportEvent } from '../lib/exportstate.js';
import {
  captureFraction,
  exportReducer,
  initialExportState,
  previewFrame,
} from '../lib/exportstate.js';
import { formatFrameRange, formatTime } from '../lib/frametime.js';
import type { LoopState } from '../lib/loop.js';
import { engagedLoop } from '../lib/loop.js';
import { DialogShell } from './DialogShell.js';
import { ExportCanceled } from './ExportCanceled.js';
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
  const loopPoints = engagedLoop(loop);
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

  async function runBridgeAction<T extends ExportAck>(
    call: (bridge: AppBridge) => Promise<T>,
    onFailure: (error: string) => ExportEvent,
    fallback?: string,
  ): Promise<T | null> {
    try {
      const ack = await call(appBridge());
      if (!ack.ok) {
        const refused = ack.error ?? fallback;
        if (refused) dispatch(onFailure(refused));
      }
      return ack;
    } catch (e) {
      dispatch(onFailure(errorMessage(e)));
      return null;
    }
  }

  const pickDestination = async (): Promise<string | null> => {
    const picked = await runBridgeAction(
      (bridge) => bridge.pickExportOutput(),
      (error) => ({ type: 'failed', error }),
    );
    return picked?.ok && picked.path ? picked.path : null;
  };

  const buildRequest = (outPath: string): ExportRequest => ({
    outPath,
    config: { ...settings, width: form.width, height: form.height },
    range: segment && form.range ? segment.range : null,
  });

  const startJob = async (request: ExportRequest): Promise<void> => {
    dispatch({ type: 'start', request });
    await runBridgeAction(
      (bridge) => bridge.startExport(request),
      (error) => ({ type: 'startFailed', error }),
      'export could not start',
    );
  };

  const chooseAndExport = async (): Promise<void> => {
    const outPath = await pickDestination();
    if (outPath === null) return;
    dispatch({ type: 'choose', path: outPath });
    await startJob(buildRequest(outPath));
  };

  const cancelExport = (): void => {
    dispatch({ type: 'cancelRequested' });
    void runBridgeAction(
      (bridge) => bridge.cancelExport(),
      (error) => ({ type: 'cancelFailed', error }),
      'export could not be canceled',
    );
  };

  const runDoneAction = (call: (bridge: AppBridge) => Promise<ExportAck>): void => {
    dispatch({ type: 'clearError' });
    void runBridgeAction(call, (error) => ({ type: 'failed', error }), 'action failed');
  };

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
          />
        ) : null}
        <div className="export-phase">
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
              onStart={() => void chooseAndExport()}
            />
          ) : null}

          {phase === 'running' ? (
            <ExportRunning
              fraction={captureFraction(state.capture)}
              canceling={canceling}
              error={error}
              onCancel={cancelExport}
            />
          ) : null}

          {phase === 'done' && result ? (
            <ExportDone
              result={result}
              error={error}
              onReveal={() =>
                runDoneAction((bridge) => bridge.revealExportOutput({ out: result.out }))
              }
              onOpen={() => runDoneAction((bridge) => bridge.openExportOutput({ out: result.out }))}
              onClose={onClose}
            />
          ) : null}

          {phase === 'canceled' ? <ExportCanceled onClose={onClose} /> : null}

          {phase === 'error' && error ? <ExportError error={error} onClose={onClose} /> : null}
        </div>
      </div>
    </DialogShell>
  );
}
