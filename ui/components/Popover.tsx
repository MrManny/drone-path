'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

import { DialogClose } from './DialogClose.js';

interface PopoverProps {
  label: string;
  triggerRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

export function Popover({ label, triggerRef, onClose, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
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
