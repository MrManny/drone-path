'use client';

import type { HudLayout } from '../../src/config.js';
import type { ChipReadouts, HudChipId } from '../lib/chipreadouts.js';
import { formatChipValue } from '../lib/chipreadouts.js';

export interface HudChipsProps {
  hud: HudLayout;
  /** Values at the preview frame; a missing value shows "--". */
  readouts: ChipReadouts;
  /** The ALT chip cannot render without altitude telemetry and stays off. */
  altUnavailable: boolean;
  onToggle: (chip: HudChipId) => void;
}

const CHIP_LABELS: Record<HudChipId, string> = {
  heading: 'Heading',
  alt: 'ALT',
  speed: 'SPD',
};

const CHIP_UNITS: Record<HudChipId, string> = {
  heading: '',
  alt: 'm',
  speed: 'm/s',
};

/** The on-frame readouts as the chips themselves; clicking one toggles it. */
export function HudChips({ hud, readouts, altUnavailable, onToggle }: HudChipsProps) {
  return (
    <div className="hud-chips" role="group" aria-label="On-frame readouts">
      {(['heading', 'alt', 'speed'] as const).map((chip) => {
        const disabled = chip === 'alt' && altUnavailable;
        const on = hud[chip] && !disabled;
        const text = on ? formatChipValue(chip, readouts) : '--';
        // The arrow encodes the heading as rotation only, so the button names
        // the degrees for screen readers (WCAG 1.1.1).
        const headingName =
          chip === 'heading' && on && readouts.headingDeg !== null
            ? `Heading, ${Math.round(readouts.headingDeg)}°`
            : undefined;
        return (
          <button
            key={chip}
            type="button"
            className="hud-chip"
            aria-label={headingName}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(chip)}
          >
            <span className="label">{CHIP_LABELS[chip]}</span>
            {chip === 'heading' && on && readouts.headingDeg !== null ? (
              <span
                className="chip-arrow"
                aria-hidden="true"
                style={{ transform: `rotate(${readouts.headingDeg}deg)` }}
              >
                ▲
              </span>
            ) : (
              <span className="num">{text}</span>
            )}
            {CHIP_UNITS[chip] ? <span className="unit">{CHIP_UNITS[chip]}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
