'use client';

import type { TelemetrySavePhase } from '../lib/telemetrysave.js';
import { DialogShell } from './DialogShell.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';

export interface TelemetrySaveModalProps {
  /** What the document covers, in the shared scope vocabulary. */
  scope: string;
  /** The flow's phase: the write in flight, then its outcome. */
  phase: TelemetrySavePhase;
  onReveal: () => void;
  onClose: () => void;
}

// The compact Save telemetry JSON dialog: one write, so one phase column and
// no preview. The done phase names the kept file and its scope like the
// export dialog names its render.
export function TelemetrySaveModal({
  scope,
  phase,
  onReveal,
  onClose,
}: TelemetrySaveModalProps) {
  return (
    <DialogShell title="Save telemetry JSON" onClose={onClose}>
      {phase.kind === 'saving' ? <Notice tone="info">Saving telemetry JSON…</Notice> : null}

      {phase.kind === 'done' ? (
        <>
          {phase.error ? <ErrorNotice message={phase.error} /> : null}
          <Notice tone="info">Telemetry JSON saved.</Notice>
          <p className="export-path">{phase.path}</p>
          <p className="export-path">{`Scope: ${scope}`}</p>
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
