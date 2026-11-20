'use client';

import { useTranslation } from '../lib/i18n.js';
import type { ReactNode } from 'react';

import { X } from 'lucide-react';

export type NoticeTone = 'info' | 'warning' | 'danger';

interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  details?: string | null;
  onDismiss?: () => void;
}

export function Notice({ tone, children, details, onDismiss }: NoticeProps) {
  const t = useTranslation();
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="notice-body">
        <p className="notice-text">{children}</p>
        {details ? (
          <details className="notice-details">
            <summary>{t('notice.technicalDetails')}</summary>
            <pre lang="en">{details}</pre>
          </details>
        ) : null}
      </div>
      {onDismiss ? (
        <button type="button" className="notice-dismiss" onClick={onDismiss}>
          <X size={16} />
          {t('notice.dismiss')}
        </button>
      ) : null}
    </div>
  );
}
