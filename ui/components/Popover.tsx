'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

import { DialogClose } from './DialogClose.js';

export interface PopoverProps {
  /** The popover's name, on its header and its accessible name. */
  label: string;
  /** The toggle button; its clicks close through the toggle, not the outside rule. */
  triggerRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

// A non-modal popover: no scrim and no focus trap, so player shortcuts stay
// live while it is open; Escape reaches it through the player's overlay
// routing.
export function Popover({ label, triggerRef, onClose, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      // Closing on the trigger's press would reopen it on the click that
      // follows; the toggle handles those presses.
      if (triggerRef?.current?.contains(target)) return;
      if (panelRef.current && !panelRef.current.contains(target)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose, triggerRef]);

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
