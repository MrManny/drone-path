'use client';

import { useTranslation } from '../lib/i18n.js';
import type { RecordingSummary } from '../../src/pipeline.js';
import { formatExportSummary } from '../lib/exportsummary.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';

export interface ExportDoneProps {
  result: RecordingSummary;
  error: string | null;
}

export function ExportDone({ result, error }: ExportDoneProps) {
  const t = useTranslation();
  return (
    <>
      {error ? <ErrorNotice message={error} /> : null}
      <Notice tone="info">{formatExportSummary(result, t)}</Notice>
      <p className="export-path" title={result.out}>
        {result.out}
      </p>
    </>
  );
}
