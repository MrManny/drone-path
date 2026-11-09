'use client';

import { useId, useState } from 'react';

export interface ColorFieldProps {
  label: string;
  /** null = the unset value: the feature's default applies. */
  value: string | null;
  /** Canonicalizes a draft to the stored value; throws on input it cannot read. */
  parse: (raw: string) => string | null;
  /** The rule a rejected value breaks, phrased to follow "must be", e.g. "hex like #e63946". */
  rule: string;
  hint?: string;
  /** Returns whether the value committed; a rejected draft stays visible with its message until blur. */
  onValue: (value: string | null) => boolean;
}

// The NumberField contract for hex colors: empty means "the default applies",
// an unreadable draft is blocked with its rule until blur reverts it, and the
// swatch shows the committed color. The message takes the hint's place, so
// showing or clearing it never changes the row's layout.
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
          // onValue commits the value upstream (a side effect), so it runs
          // only once the field's own checks have passed.
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
