'use client';

import { CloseIcon } from '../icons/CloseIcon.js';

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
      <CloseIcon />
      Close
    </button>
  );
}
