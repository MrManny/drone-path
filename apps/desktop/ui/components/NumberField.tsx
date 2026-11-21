'use client';

import { DraftField } from './DraftField.js';

export interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  rule: string;
  step?: number;
  /** Unit shown beside the field, e.g. "s". */
  unit?: string;
  hint?: string;
  onValue: (value: number) => boolean;
}

export function NumberField({ label, value, min, rule, step, unit, hint, onValue }: NumberFieldProps) {
  return (
    <DraftField
      label={label}
      value={String(value)}
      inputProps={{ type: 'number', min, step: step ?? 1 }}
      parse={(raw) => {
        const parsed = raw === '' ? Number.NaN : Number(raw);
        return Number.isFinite(parsed) && parsed >= min ? { ok: true, value: parsed } : { ok: false };
      }}
      rule={rule}
      hint={hint}
      suffix={unit ? <span className="field-unit">{unit}</span> : null}
      onValue={onValue}
    />
  );
}
