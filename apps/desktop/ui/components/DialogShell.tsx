'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { useModalFocus } from '../hooks/useModalFocus.js';
import { DialogClose } from './DialogClose.js';

interface DialogShellProps {
  title: string;
  onClose: () => void;
  blockedReason?: string;
  closeOnBackdrop?: boolean;
  panelClass?: string;
  /** When this key changes, focus moves to an enabled [data-phase-focus] target or the panel. */
  focusKey?: string;
  children: ReactNode;
}

export function DialogShell({
  title,
  onClose,
  blockedReason,
  closeOnBackdrop = true,
  panelClass,
  focusKey,
  children,
}: DialogShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus belongs on the dialog, not the opener behind the scrim; closing
  // returns it. Tab stays inside the panel for the same reason.
  useModalFocus(panelRef);

  // A phase change unmounts the old phase's action; focus follows to the new
  // primary action (or the panel) so it never lands on <body>.
  const seenFocusKey = useRef(focusKey);
  useEffect(() => {
    if (focusKey === undefined || seenFocusKey.current === focusKey) return;
    seenFocusKey.current = focusKey;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>('[data-phase-focus]:not(:disabled)');
    (target ?? panel)?.focus();
  }, [focusKey]);

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
