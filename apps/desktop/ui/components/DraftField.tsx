'use client';

import { useTranslation } from '../lib/i18n.js';
import { useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface DraftFieldProps<T> {
  label: string;
  value: string;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'id' | 'value' | 'aria-invalid' | 'aria-describedby' | 'onChange' | 'onBlur'
  >;
  parse: (raw: string) => { ok: true; value: T } | { ok: false };
  rule: string;
  hint?: string;
  suffix?: ReactNode;
  onValue: (value: T) => boolean;
}

export function DraftField<T>({
  label,
  value,
  inputProps,
  parse,
  rule,
  hint,
  suffix,
  onValue,
}: DraftFieldProps<T>) {
  const t = useTranslation();
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
        {...inputProps}
        id={id}
        value={draft ?? value}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? messageId : hint ? hintId : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = parse(raw);
          if (!parsed.ok) {
            setInvalid(true);
            return;
          }
          setInvalid(!onValue(parsed.value));
        }}
        onBlur={() => {
          setDraft(null);
          setInvalid(false);
        }}
      />
      {suffix}
      {invalid ? (
        <span className="field-message" id={messageId}>
          {t('field.mustBe', { rule })}
        </span>
      ) : hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
