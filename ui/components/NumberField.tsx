'use client';

import { useId, useState } from 'react';

export interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  rule: string;
  step?: number;
  hint?: string;
  onValue: (value: number) => boolean;
}

export function NumberField({ label, value, min, rule, step, hint, onValue }: NumberFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hintId = `${id}-hint`;
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        step={step ?? 1}
        value={draft ?? String(value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? messageId : hint ? hintId : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = raw === '' ? Number.NaN : Number(raw);
          if (!Number.isFinite(parsed) || parsed < min) {
            setInvalid(true);
            return;
          }
          setInvalid(!onValue(parsed));
        }}
        onBlur={() => {
          setDraft(null);
          setInvalid(false);
        }}
      />
      {invalid ? (
        <span className="field-message" id={messageId}>
          {`Must be ${rule}.`}
        </span>
      ) : hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
