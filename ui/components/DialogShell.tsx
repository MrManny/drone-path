'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { DialogClose } from './DialogClose.js';

export interface DialogShellProps {
  title: string;
  onClose: () => void;
  blockedReason?: string;
  closeOnBackdrop?: boolean;
  panelClass?: string;
  children: ReactNode;
}

export function DialogShell({
  title,
  onClose,
  blockedReason,
  closeOnBackdrop = true,
  panelClass,
  children,
}: DialogShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus belongs on the dialog, not the opener behind the scrim; closing
  // returns it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <div
      className="settings-overlay"
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={panelClass ? `settings-panel ${panelClass}` : 'settings-panel'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>{title}</h2>
          <DialogClose onClose={onClose} blockedReason={blockedReason} />
        </div>
        {children}
      </div>
    </div>
  );
}
