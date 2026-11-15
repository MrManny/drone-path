'use client';

import { useState } from 'react';

import { asTrailColor } from '../../src/config.js';
import { CUSTOM_SWATCH, TRAIL_SWATCHES, swatchIdFor } from '../lib/trailcolor.js';
import { ColorField } from './ColorField.js';

interface TrailColorSwatchesProps {
  value: string | null;
  onChange: (value: string | null) => boolean;
}

/** Trail color as a swatch row; Custom… reveals the hex field. */
export function TrailColorSwatches({ value, onChange }: TrailColorSwatchesProps) {
  const [customOpen, setCustomOpen] = useState(() => swatchIdFor(value) === 'custom');
  const [prevValue, setPrevValue] = useState(value);
  // A value reset from outside (Restore defaults) ends custom mode too, so the
  // pressed swatch always names the stored color.
  if (value !== prevValue) {
    setPrevValue(value);
    if (value === null) setCustomOpen(false);
  }
  return (
    <div>
      <div className="trail-swatches" role="group" aria-label="Trail color">
        {TRAIL_SWATCHES.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            className="trail-swatch"
            aria-pressed={!customOpen && swatchIdFor(value) === swatch.id}
            onClick={() => {
              setCustomOpen(false);
              onChange(swatch.value);
            }}
          >
            <span
              className={
                swatch.value === null ? 'trail-swatch-dot style-default' : 'trail-swatch-dot'
              }
              style={swatch.value === null ? undefined : { background: swatch.value }}
              aria-hidden="true"
            />
            <span className="trail-swatch-label">{swatch.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="trail-swatch trail-swatch-custom"
          aria-pressed={customOpen}
          onClick={() => setCustomOpen(true)}
        >
          {CUSTOM_SWATCH.label}
        </button>
      </div>
      {customOpen ? (
        <ColorField
          label="Hex"
          value={value}
          parse={(raw) => asTrailColor(raw, 'trail color')}
          rule="hex like #e63946"
          onValue={(next) => {
            // Clearing the field means the style default, so custom mode ends.
            if (next === null) setCustomOpen(false);
            return onChange(next);
          }}
        />
      ) : null}
    </div>
  );
}
