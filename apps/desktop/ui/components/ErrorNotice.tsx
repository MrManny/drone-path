'use client';

import type { StructuredError } from '../../shared/errors.js';
import { useTranslation } from '../lib/i18n.js';
import { describeError } from '../lib/errortext.js';
import { Notice } from './Notice.js';

interface ErrorNoticeProps {
  error: StructuredError;
  lead?: string;
  onDismiss?: () => void;
}

export function ErrorNotice({ error, lead, onDismiss }: ErrorNoticeProps) {
  const t = useTranslation();
  const { text, technical } = describeError(error, t);
  return (
    <Notice tone="danger" details={technical} onDismiss={onDismiss}>
      {`${lead ? `${lead} ` : ''}${text}`}
    </Notice>
  );
}
