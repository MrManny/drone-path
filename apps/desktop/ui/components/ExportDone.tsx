'use client';

import type { StructuredError } from '../../shared/errors.js';
import { useTranslation } from '../lib/i18n.js';
import type { RecordingSummary } from 'drone-path-engine/pipeline';
import { formatExportSummary } from '../lib/exportsummary.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';

export interface ExportDoneProps {
  result: RecordingSummary;
  error: StructuredError | null;
}

export function ExportDone({ result, error }: ExportDoneProps) {
  const t = useTranslation();
  return (
    <>
      {error ? <ErrorNotice error={error} /> : null}
      <Notice tone="info">{formatExportSummary(result, t)}</Notice>
      <p className="export-path" title={result.out}>
        {result.out}
      </p>
    </>
  );
}
