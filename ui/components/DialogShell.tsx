'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { DialogClose } from './DialogClose.js';

export interface DialogShellProps {
  /** The window title and the dialog's accessible name. */
  title: string;
  onClose: () => void;
  /** Set while closing would interrupt running work: the header close says why and stays disabled. */
  blockedReason?: string;
  /** Backdrop clicks dismiss only while nothing is running. */
  closeOnBackdrop?: boolean;
  children: ReactNode;
}

// The dialog anatomy the design guidelines define, in one place: overlay,
// panel and header never change shape between dialogs or phases.
export function DialogShell({
  title,
  onClose,
  blockedReason,
  closeOnBackdrop = true,
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
        className="settings-panel"
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
