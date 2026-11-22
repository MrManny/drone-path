'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';

// Everything a keyboard user can reach inside the panel; surfaces that manage
// their own roving focus (like menu rows) or inert credits opt out with tabindex="-1".
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), summary:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

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

    // Listen on document so Tab stays trapped even when focus falls back to <body>.
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [panelRef]);
}
