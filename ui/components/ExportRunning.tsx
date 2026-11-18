'use client';

import { ErrorNotice } from './ErrorNotice.js';
import { ProgressBar } from './ProgressBar.js';

export interface ExportRunningProps {
  fraction: number | null;
  error: string | null;
}

export function ExportRunning({ fraction, error }: ExportRunningProps) {
  const percent = fraction === null ? null : Math.round(fraction * 100);
  return (
    <>
      <div className="export-progress">
        <ProgressBar label="Export progress" percent={percent} />
      </div>
      {error ? <ErrorNotice message={error} /> : null}
    </>
  );
}
