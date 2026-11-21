'use client';

import { DraftField } from './DraftField.js';

export interface ColorFieldProps {
  label: string;
  value: string | null;
  parse: (raw: string) => string | null;
  rule: string;
  hint?: string;
  onValue: (value: string | null) => boolean;
}

export function ColorField({ label, value, parse, rule, hint, onValue }: ColorFieldProps) {
  return (
    <DraftField
      label={label}
      value={value ?? ''}
      inputProps={{ type: 'text' }}
      parse={(raw) => {
        try {
          return { ok: true, value: raw === '' ? null : parse(raw) };
        } catch {
          return { ok: false };
        }
      }}
      rule={rule}
      hint={hint}
      suffix={
        <span
          className={value === null ? 'color-swatch color-swatch-empty' : 'color-swatch'}
          style={{ background: value ?? undefined }}
          aria-hidden="true"
        />
      }
      onValue={onValue}
    />
  );
}
