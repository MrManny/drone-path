'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { DialogClose } from './DialogClose.js';

export interface PopoverProps {
  /** The popover's name, on its header and its accessible name. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}

// A non-modal popover: no scrim and no focus trap — player shortcuts stay
// live while it is open — but it takes focus on open, closes on Escape (the
// player routes Escape here), an outside click, or its Close button.
export function Popover({ label, onClose, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose]);

  return (
    <div className="map-popover" role="dialog" aria-label={label} tabIndex={-1} ref={panelRef}>
      <div className="map-popover-header">
        <h2>{label}</h2>
        <DialogClose onClose={onClose} />
      </div>
      {children}
    </div>
  );
}
