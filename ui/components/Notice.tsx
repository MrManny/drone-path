'use client';

import type { ReactNode } from 'react';

import { CloseIcon } from '../icons/CloseIcon.js';

export type NoticeTone = 'info' | 'warning' | 'danger';

export interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  details?: string | null;
  onDismiss?: () => void;
}

export function Notice({ tone, children, details, onDismiss }: NoticeProps) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="notice-body">
        <p className="notice-text">{children}</p>
        {details ? (
          <details className="notice-details">
            <summary>Technical details</summary>
            <pre>{details}</pre>
          </details>
        ) : null}
      </div>
      {onDismiss ? (
        <button type="button" className="notice-dismiss" onClick={onDismiss}>
          <CloseIcon />
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
