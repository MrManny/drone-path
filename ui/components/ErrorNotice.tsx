'use client';

import { describeError } from '../lib/errortext.js';
import { Notice } from './Notice.js';

interface ErrorNoticeProps {
  message: string;
  lead?: string;
  onDismiss?: () => void;
}

export function ErrorNotice({ message, lead, onDismiss }: ErrorNoticeProps) {
  const { text, technical } = describeError(message);
  return (
    <Notice tone="danger" details={technical} onDismiss={onDismiss}>
      {`${lead ? `${lead} ` : ''}${text}`}
    </Notice>
  );
}
