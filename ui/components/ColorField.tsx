'use client';

import { useId, useState } from 'react';

export interface ColorFieldProps {
  label: string;
  value: string | null;
  parse: (raw: string) => string | null;
  rule: string;
  hint?: string;
  onValue: (value: string | null) => boolean;
}

export function ColorField({ label, value, parse, rule, hint, onValue }: ColorFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={draft ?? value ?? ''}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? messageId : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          let parsed: string | null;
          try {
            parsed = raw === '' ? null : parse(raw);
          } catch {
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
      <span
        className={value === null ? 'color-swatch color-swatch-empty' : 'color-swatch'}
        style={{ background: value ?? undefined }}
        aria-hidden="true"
      />
      {invalid ? (
        <span className="field-message" id={messageId}>
          {`Must be ${rule}.`}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}
