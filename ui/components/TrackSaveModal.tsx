'use client';

import { useEffect, useRef } from 'react';

import type { TrackSavePhase } from '../lib/tracksave.js';
import { trackPhaseText } from '../lib/tracksave.js';
import { DialogShell } from './DialogShell.js';
import { ErrorNotice } from './ErrorNotice.js';

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
  // A phase change unmounts the old phase's action; focus follows the flow to
  // the new primary action (or the dialog) so it never lands on <body>.
  const bodyRef = useRef<HTMLDivElement>(null);
  const seenKind = useRef(phase.kind);
  useEffect(() => {
    if (seenKind.current === phase.kind) return;
    seenKind.current = phase.kind;
    const body = bodyRef.current;
    const target = body?.querySelector<HTMLElement>('[data-phase-focus]');
    const fallback = body?.closest('[role="dialog"]') as HTMLElement | null;
    (target ?? fallback)?.focus();
  }, [phase.kind]);

  return (
    <DialogShell
      title="Export telemetry"
      onClose={onClose}
      closeOnBackdrop={dismissible}
      blockedReason={dismissible ? undefined : 'Exporting telemetry. Wait for it to finish.'}
    >
      <div ref={bodyRef}>
        <p className="phase-status" role="status">
          {trackPhaseText(phase)}
        </p>

        {phase.kind === 'done' ? (
          <>
            {phase.error ? <ErrorNotice message={phase.error} /> : null}
            <p className="export-path" title={phase.path}>
              {phase.path}
            </p>
            <p className="export-path">{`Covers the ${phase.scope}`}</p>
            <div className="dialog-actions">
              <button type="button" className="dialog-primary" data-phase-focus onClick={onReveal}>
                Reveal in folder
              </button>
            </div>
          </>
        ) : null}

        {phase.kind === 'error' ? <ErrorNotice message={phase.message} /> : null}
      </div>
    </DialogShell>
  );
}
