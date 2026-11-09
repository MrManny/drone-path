'use client';

import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface MapAppearance {
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  toggle: () => void;
  close: () => void;
}

export function useMapAppearance(): MapAppearance {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const toggle = useCallback(() => {
    if (open) close();
    else setOpen(true);
  }, [open, close]);
  return { open, triggerRef, toggle, close };
}
