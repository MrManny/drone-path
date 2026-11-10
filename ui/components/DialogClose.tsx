'use client';

import { X } from 'lucide-react';

export interface DialogCloseProps {
  onClose: () => void;
  blockedReason?: string;
}

export function DialogClose({ onClose, blockedReason }: DialogCloseProps) {
  return (
    <button
      type="button"
      aria-label="Close"
      title={blockedReason}
      disabled={blockedReason !== undefined}
      onClick={onClose}
    >
      <X size={16} />
      Close
    </button>
  );
}
