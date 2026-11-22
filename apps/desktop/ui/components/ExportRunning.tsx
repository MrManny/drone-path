'use client';

import type { StructuredError } from '../../shared/errors.js';
import { useTranslation } from '../lib/i18n.js';
import { ErrorNotice } from './ErrorNotice.js';
import { ProgressBar } from './ProgressBar.js';

export interface ExportRunningProps {
  fraction: number | null;
  error: StructuredError | null;
}

export function ExportRunning({ fraction, error }: ExportRunningProps) {
  const t = useTranslation();
  const percent = fraction === null ? null : Math.round(fraction * 100);
  return (
    <>
      <div className="export-progress">
        <ProgressBar label={t('exportRunning.exportProgress')} percent={percent} />
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </>
  );
}
