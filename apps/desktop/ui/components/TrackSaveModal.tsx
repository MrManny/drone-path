'use client';

import { useTranslation } from '../lib/i18n.js';

import type { TrackSavePhase } from '../lib/tracksave.js';
import { trackPhaseText } from '../lib/tracksave.js';
import { DialogShell } from './DialogShell.js';
import { ErrorNotice } from './ErrorNotice.js';
import { ProgressBar } from './ProgressBar.js';

export interface TrackSaveModalProps {
  phase: TrackSavePhase;
  dismissible: boolean;
  onReveal: () => void;
  onClose: () => void;
}

export function TrackSaveModal({
  phase,
  dismissible,
  onReveal,
  onClose,
}: TrackSaveModalProps) {
  const t = useTranslation();

  return (
    <DialogShell
      title={t('trackSaveModal.exportTelemetry')}
      onClose={onClose}
      closeOnBackdrop={dismissible}
      blockedReason={dismissible ? undefined : t('trackSaveModal.busyClose')}
      focusKey={phase.kind}
    >
      <div>
        {phase.kind === 'saving' ? (
          <ProgressBar label={t('trackSaveModal.telemetryExportProgress')} percent={null} />
        ) : null}
        <p className="phase-status" role="status">
          {trackPhaseText(phase, t)}
        </p>

        {phase.kind === 'done' ? (
          <>
            {phase.error ? <ErrorNotice message={phase.error} /> : null}
            <p className="export-path" title={phase.path}>
              {phase.path}
            </p>
            <p className="hint">{t('trackSaveModal.covers', { scope: phase.scope })}</p>
          </>
        ) : null}

        {phase.kind === 'error' ? <ErrorNotice message={phase.message} /> : null}
        {phase.kind === 'saving' || phase.kind === 'done' ? (
          <div className="dialog-actions">
            <button
              type="button"
              className="dialog-primary"
              data-phase-focus
              disabled={phase.kind === 'saving'}
              onClick={onReveal}
            >
              {t('trackSaveModal.revealInFolder')}
            </button>
          </div>
        ) : null}
      </div>
    </DialogShell>
  );
}
