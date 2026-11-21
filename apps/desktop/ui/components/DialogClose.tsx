'use client';

import { useTranslation } from '../lib/i18n.js';
import { X } from 'lucide-react';

interface DialogCloseProps {
  onClose: () => void;
  blockedReason?: string;
}

export function DialogClose({ onClose, blockedReason }: DialogCloseProps) {
  const t = useTranslation();
  return (
    <button
      type="button"
      aria-label={t('dialogClose.close')}
      title={blockedReason}
      disabled={blockedReason !== undefined}
      onClick={onClose}
    >
      <X size={16} />
      {t('dialogClose.close')}
    </button>
  );
}
