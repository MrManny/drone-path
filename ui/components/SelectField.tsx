'use client';

import { useId } from 'react';

export interface SelectFieldProps {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  hint?: string;
  onValue: (value: string) => void;
}

export function SelectField({ label, value, options, hint, onValue }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onValue(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
