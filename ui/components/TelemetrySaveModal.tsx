'use client';

import type { TelemetrySavePhase } from '../lib/telemetrysave.js';
import { DialogShell } from './DialogShell.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';

export interface TelemetrySaveModalProps {
  phase: TelemetrySavePhase;
  dismissible: boolean;
  onReveal: () => void;
  onClose: () => void;
}

export function TelemetrySaveModal({
  phase,
  dismissible,
  onReveal,
  onClose,
}: TelemetrySaveModalProps) {
  return (
    <DialogShell
      title="Save telemetry JSON"
      onClose={onClose}
      closeOnBackdrop={dismissible}
      blockedReason={dismissible ? undefined : 'Saving telemetry JSON. Wait for it to finish.'}
    >
      {phase.kind === 'saving' ? <Notice tone="info">Saving telemetry JSON…</Notice> : null}

      {phase.kind === 'done' ? (
        <>
          {phase.error ? <ErrorNotice message={phase.error} /> : null}
          <Notice tone="info">Telemetry JSON saved.</Notice>
          <p className="export-path">{phase.path}</p>
          <p className="export-path">{`Scope: ${phase.scope}`}</p>
          <div className="dialog-actions">
            <button type="button" onClick={onReveal}>
              Reveal in folder
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}

      {phase.kind === 'error' ? (
        <>
          <ErrorNotice message={phase.message} />
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}
    </DialogShell>
  );
}
