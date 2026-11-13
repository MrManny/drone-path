'use client';

import { ErrorNotice } from './ErrorNotice.js';
import { ProgressBar } from './ProgressBar.js';

export interface ExportRunningProps {
  fraction: number | null;
  canceling: boolean;
  error: string | null;
  onCancel: () => void;
}

export function ExportRunning({ fraction, canceling, error, onCancel }: ExportRunningProps) {
  const percent = fraction === null ? null : Math.round(fraction * 100);
  return (
    <>
      <div className="export-progress">
        <ProgressBar label="Export progress" percent={percent} />
      </div>
      {error ? <ErrorNotice message={error} /> : null}
      <div className="dialog-actions">
        <button type="button" data-phase-focus onClick={onCancel} disabled={canceling}>
          Cancel export
        </button>
      </div>
    </>
  );
}
