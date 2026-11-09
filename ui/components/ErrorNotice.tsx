'use client';

import { describeError } from '../lib/errortext.js';
import { Notice } from './Notice.js';

export interface ErrorNoticeProps {
  message: string;
  lead?: string;
  tail?: string;
  onDismiss?: () => void;
}

export function ErrorNotice({ message, lead, tail, onDismiss }: ErrorNoticeProps) {
  const { text, technical } = describeError(message);
  return (
    <Notice tone="danger" details={technical} onDismiss={onDismiss}>
      {`${lead ? `${lead} ` : ''}${text}${tail ? ` ${tail}` : ''}`}
    </Notice>
  );
}
