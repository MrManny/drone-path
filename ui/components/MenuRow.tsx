'use client';

import type { ReactNode } from 'react';

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
}: MenuRowProps) {
  return (
    <button
      type="button"
      className={`menu-row${active ? ' active' : ''}`}
      disabled={disabled}
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
