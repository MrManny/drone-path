'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';

// Everything a keyboard user can reach inside the panel; surfaces that manage
// their own roving focus (like menu rows) opt out with tabindex="-1".
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus for dialogs and overlays: focus moves in on open, returns to the
 * opener on close, and Tab wraps within the panel so focus cannot leave it.
 */
export function useModalFocus(panelRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const opener = document.activeElement as HTMLElement | null;
    panel.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active !== null && panel.contains(active) && active !== panel;
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          (last ?? panel).focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        (first ?? panel).focus();
      }
    };

    panel.addEventListener('keydown', onKeyDown);
    return () => {
      panel.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [panelRef]);
}
