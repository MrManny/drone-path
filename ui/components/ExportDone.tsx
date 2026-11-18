'use client';

import type { RecordingSummary } from '../../src/pipeline.js';
import { formatExportSummary } from '../lib/exportsummary.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';

export interface ExportDoneProps {
  result: RecordingSummary;
  error: string | null;
}

export function ExportDone({ result, error }: ExportDoneProps) {
  return (
    <>
      {error ? <ErrorNotice message={error} /> : null}
      <Notice tone="info">{formatExportSummary(result)}</Notice>
      <p className="export-path" title={result.out}>
        {result.out}
      </p>
    </>
  );
}
