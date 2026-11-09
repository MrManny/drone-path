'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { DialogClose } from './DialogClose.js';

export interface DialogShellProps {
  title: string;
  onClose: () => void;
  /** Set while closing would interrupt running work: the header close says why and stays disabled. */
  blockedReason?: string;
  closeOnBackdrop?: boolean;
  /** Extra panel class for dialogs that widen the default panel (e.g. export). */
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

  // Keyboard and screen-reader focus belong on the dialog, not on whatever
  // opened it behind the scrim; closing hands focus back to the opener.
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
