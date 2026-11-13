'use client';

import type { RecordingSummary } from '../../src/pipeline.js';
import { formatExportSummary } from '../lib/exportsummary.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';

export interface ExportDoneProps {
  result: RecordingSummary;
  error: string | null;
  onReveal: () => void;
  onOpen: () => void;
}

export function ExportDone({ result, error, onReveal, onOpen }: ExportDoneProps) {
  return (
    <>
      {error ? <ErrorNotice message={error} /> : null}
      <Notice tone="info">{formatExportSummary(result)}</Notice>
      <p className="export-path" title={result.out}>
        {result.out}
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onOpen}>
          Open video
        </button>
        <button type="button" className="dialog-primary" data-phase-focus onClick={onReveal}>
          Reveal in folder
        </button>
      </div>
    </>
  );
}
