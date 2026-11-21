'use client';

import { useTranslation } from '../lib/i18n.js';
import { describeError } from '../lib/errortext.js';
import { Notice } from './Notice.js';

interface ErrorNoticeProps {
  message: string;
  lead?: string;
  onDismiss?: () => void;
}

export function ErrorNotice({ message, lead, onDismiss }: ErrorNoticeProps) {
  const t = useTranslation();
  const { text, technical } = describeError(message, t);
  return (
    <Notice tone="danger" details={technical} onDismiss={onDismiss}>
      {`${lead ? `${lead} ` : ''}${text}`}
    </Notice>
  );
}
