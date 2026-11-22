'use client';

import type { FrameRange } from 'drone-path-core/frame-range';
import type { EncodeSettings, RenderConfig } from 'drone-path-engine/config';
import type { UiSession } from '../../shared/ipc.js';
import type { ExportAck } from '../lib/backend.js';
import { canceledSentence } from '../lib/errortext.js';
import type { ExportFlowDeps } from '../lib/exportflow.js';
import type { ExportEvent, ExportState } from '../lib/exportstate.js';
import {
  captureFraction,
  exportPhaseText,
  exportStatusText,
  previewFrame,
} from '../lib/exportstate.js';
import { formatFrameRange, formatTime } from '../lib/frametime.js';
import { useTranslation } from '../lib/i18n.js';
import type { LoopState } from '../lib/loop.js';
import { frameRangeOf, resolveLoop } from '../lib/loop.js';
import { DialogShell } from './DialogShell.js';
import { ExportDone } from './ExportDone.js';
import { ExportForm } from './ExportForm.js';
import { ExportPreview } from './ExportPreview.js';
import { ExportRunning } from './ExportRunning.js';

export interface ExportModalProps {
  session: UiSession;
  settings: RenderConfig;
  loop: LoopState;
  state: ExportState;
  dismissible: boolean;
  onDispatch: (event: ExportEvent) => void;
  onStart: (segment: { range: FrameRange } | null) => void;
  onCancel: () => void;
  onRunDone: (call: (deps: ExportFlowDeps) => Promise<ExportAck>) => void;
  onEncoderChange: (patch: Partial<EncodeSettings>) => void;
  onClose: () => void;
}

export function ExportModal({
  session,
  settings,
  loop,
  state,
  dismissible,
  onDispatch,
  onStart,
  onCancel,
  onRunDone,
  onEncoderChange,
  onClose,
}: ExportModalProps) {
  const t = useTranslation();
  const { video, durationSec } = session;
  const loopPoints = resolveLoop(loop, video.frames - 1);
  const { phase, form, result, error, notice, canceling } = state;

  const previewConfig = state.request?.config ?? settings;
  const previewRange = state.request ? state.request.range : form.range;
  const totalText = formatTime(durationSec);
  const segment: { range: FrameRange; label: string } | null = loopPoints
    ? {
        range: frameRangeOf(loopPoints),
        label: formatFrameRange(loopPoints, video.fps, t),
      }
    : null;

  const changeEncoder = (patch: Partial<EncodeSettings>): void => {
    onDispatch({ type: 'clearError' });
    onEncoderChange(patch);
  };

  return (
    <DialogShell
      title={t('exportModal.exportVideo')}
      panelClass="export-panel"
      onClose={onClose}
      closeOnBackdrop={dismissible}
      blockedReason={dismissible ? undefined : t('exportModal.busyClose')}
      focusKey={phase}
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
          <p className="phase-status" aria-hidden="true">
            {exportPhaseText(state, t)}
          </p>
          <span className="sr-only" role="status">
            {exportStatusText(state, t)}
          </span>
          {phase === 'form' ? (
            <ExportForm
              form={form}
              segment={segment}
              totalText={totalText}
              encode={{ codec: settings.codec, quality: settings.quality, preset: settings.preset }}
              error={error}
              notice={notice ? canceledSentence(t) : null}
              dispatch={onDispatch}
              onEncoderChange={changeEncoder}
            />
          ) : null}

          {phase === 'running' ? (
            <ExportRunning fraction={captureFraction(state.capture)} error={error} />
          ) : null}

          {phase === 'done' && result ? <ExportDone result={result} error={error} /> : null}
        </div>
      </div>
      <div className="dialog-actions">
        {phase === 'form' ? (
          <>
            <button type="button" onClick={onClose}>
              {t('exportModal.cancel')}
            </button>
            <button
              type="button"
              className="dialog-primary"
              data-phase-focus
              onClick={() => onStart(segment ? { range: segment.range } : null)}
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
            onClick={onCancel}
          >
            {t('exportModal.cancelExport')}
          </button>
        ) : null}
        {phase === 'done' && result ? (
          <>
            <button
              type="button"
              onClick={() => onRunDone((deps) => deps.openExportOutput({ out: result.out }))}
            >
              {t('exportModal.openVideo')}
            </button>
            <button
              type="button"
              className="dialog-primary"
              data-phase-focus
              onClick={() => onRunDone((deps) => deps.revealExportOutput({ out: result.out }))}
            >
              {t('exportModal.revealInFolder')}
            </button>
          </>
        ) : null}
      </div>
    </DialogShell>
  );
}
