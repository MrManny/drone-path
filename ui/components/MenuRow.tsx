'use client';

import type { ReactNode, Ref } from 'react';

export interface MenuRowProps {
  label: string;
  /** Right-aligned shortcut hint, hidden from the accessible name. */
  hint?: string;
  title?: string;
  icon: ReactNode;
  active: boolean;
  disabled: boolean;
  onHover: () => void;
  onActivate: () => void;
  /** Roving focus target for the live row (aria-activedescendant is not used). */
  buttonRef?: Ref<HTMLButtonElement>;
}

export function MenuRow({
  label,
  hint,
  title,
  icon,
  active,
  disabled,
  onHover,
  onActivate,
  buttonRef,
}: MenuRowProps) {
  // aria-disabled instead of the disabled attribute: a disabled button cannot
  // hold focus, but the APG menu pattern keeps the highlight's focus on the
  // row so it is announced. Activation stays guarded in the handlers.
  return (
    <button
      type="button"
      ref={buttonRef}
      role="menuitem"
      aria-disabled={disabled || undefined}
      className={`menu-row${active ? ' active' : ''}`}
      tabIndex={-1}
      title={title}
      aria-keyshortcuts={hint?.replace('Ctrl+', 'Control+')}
      onClick={disabled ? undefined : onActivate}
      onMouseEnter={disabled ? undefined : onHover}
    >
      <span className="menu-selbar" aria-hidden="true" />
      <span className="menu-item-icon">{icon}</span>
      <span className="menu-item-label">{label}</span>
      {hint ? (
        <span className="menu-item-hint" aria-hidden="true">
          {hint}
        </span>
      ) : null}
    </button>
  );
}
