'use client';

import { useEffect, useReducer } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { EncodeSettings, ExportRequest, FrameRange, RenderConfig } from '../../src/config.js';
import { errorMessage } from '../../src/errors.js';
import type { AppBridge, ExportAck } from '../lib/backend.js';
import { appBridge } from '../lib/backend.js';
import type { DialogRunEvent } from '../lib/dialogstate.js';
import type { ExportEvent } from '../lib/exportstate.js';
import { captureFraction, exportReducer, initialExportState } from '../lib/exportstate.js';
import { formatFrameRange, formatTime } from '../lib/frametime.js';
import type { LoopState } from '../lib/loop.js';
import { engagedLoop } from '../lib/loop.js';
import { DialogShell } from './DialogShell.js';
import { ExportCanceled } from './ExportCanceled.js';
import { ExportDone } from './ExportDone.js';
import { ExportError } from './ExportError.js';
import { ExportForm } from './ExportForm.js';
import { ExportRunning } from './ExportRunning.js';

export interface ExportModalProps {
  session: UiSession;
  settings: RenderConfig;
  loop: LoopState;
  onClose: () => void;
  /** From the dialog state machine: a running job pins the dialog open. */
  dismissible: boolean;
  /** Feeds the dialog state machine the job's lifecycle. */
  onRunEvent: (event: DialogRunEvent) => void;
  /** Encoder edits persist through the page's settings change. */
  onEncoderChange: (patch: Partial<EncodeSettings>) => void;
  /** The session's last committed sizes; the form reopens on them. */
  initialSizes?: { width: number; height: number } | null;
  /** Reported from an effect; must be a stable callback (a state setter). */
  onSizesChange?: (sizes: { width: number; height: number }) => void;
}

export function ExportModal({
  session,
  settings,
  loop,
  onClose,
  dismissible,
  onRunEvent,
  onEncoderChange,
  initialSizes = null,
  onSizesChange,
}: ExportModalProps) {
  const { video, durationSec } = session;
  const loopPoints = engagedLoop(loop);
  // The form opens on the engaged segment and the session's last sizes: the
  // close-reopen retry keeps the choices that matter.
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
    if (busy) onRunEvent({ type: 'exportStarted' });
    return () => {
      if (busy) onRunEvent({ type: 'exportFinished' });
    };
  }, [busy, onRunEvent]);

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
  const totalText = formatTime(durationSec);
  const segment: { range: FrameRange; label: string } | null = loopPoints
    ? {
        range: { start: loopPoints.in, end: loopPoints.out },
        label: formatFrameRange(loopPoints, video.fps),
      }
    : null;

  // One shape for every bridge call: a thrown error or a refused ack becomes
  // the failure event the call site names, worded from the fallback when the
  // backend reports none. No fallback means a plain refusal is not an error:
  // that is the canceled native dialog, not a failure.
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

  // The destination comes from the native save dialog; cancelling it
  // cancels the export.
  const pickDestination = async (): Promise<string | null> => {
    const picked = await runBridgeAction(
      (bridge) => bridge.pickExportOutput(),
      (error) => ({ type: 'failed', error }),
    );
    return picked?.ok && picked.path ? picked.path : null;
  };

  // The snapshot is frozen here: the job runs this request however the
  // preview settings move afterwards. The segment export follows the frames
  // marked at confirm (the label the user reads), never a stale range; a
  // choice made without a marked segment exports the full recording.
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

  // Reveal and open act on the kept render: their failures surface in place
  // and clear as soon as the user tries again.
  const runDoneAction = (call: (bridge: AppBridge) => Promise<ExportAck>): void => {
    dispatch({ type: 'clearError' });
    void runBridgeAction(call, (error) => ({ type: 'failed', error }), 'action failed');
  };

  // Like every form edit, an encoder change clears a stale error.
  const changeEncoder = (patch: Partial<EncodeSettings>): void => {
    dispatch({ type: 'clearError' });
    onEncoderChange(patch);
  };

  return (
    <DialogShell
      title="Export"
      onClose={onClose}
      closeOnBackdrop={dismissible}
      blockedReason={dismissible ? undefined : 'Export is running. Cancel it to close.'}
    >
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
          onReveal={() => runDoneAction((bridge) => bridge.revealExportOutput({ out: result.out }))}
          onOpen={() => runDoneAction((bridge) => bridge.openExportOutput({ out: result.out }))}
          onClose={onClose}
        />
      ) : null}

      {phase === 'canceled' ? <ExportCanceled onClose={onClose} /> : null}

      {phase === 'error' && error ? <ExportError error={error} onClose={onClose} /> : null}
    </DialogShell>
  );
}
