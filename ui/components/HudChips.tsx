'use client';

import { useTranslation } from '../lib/i18n.js';
import type { HudLayout } from '../../src/config.js';
import { EXPORT_HUD_LABELS } from '../../src/renderer/dom.js';
import type { ChipReadouts, HudChipId } from '../lib/chipreadouts.js';
import { chipNames, chipAriaLabel, formatChipValue } from '../lib/chipreadouts.js';

export interface HudChipsProps {
  hud: HudLayout;
  /** The preview mirrors the abbreviations used in the rendered HUD. */
  abbreviated?: boolean;
  /** Values at the preview frame; a missing value shows "--". */
  readouts: ChipReadouts;
  /** The ALT chip cannot render without altitude telemetry and stays off. */
  altUnavailable: boolean;
  onToggle: (chip: HudChipId) => void;
}

const CHIP_UNITS: Record<HudChipId, string> = {
  heading: '',
  alt: 'm',
  speed: 'm/s',
};

/** The on-frame readouts as the chips themselves; clicking one toggles it. */
export function HudChips({
  hud,
  abbreviated = false,
  readouts,
  altUnavailable,
  onToggle,
}: HudChipsProps) {
  const t = useTranslation();
  const names = chipNames(t);
  return (
    <div className="hud-chips" role="group" aria-label={t('hudChips.onFrameReadouts')}>
      {(['heading', 'alt', 'speed'] as const).map((chip) => {
        const disabled = chip === 'alt' && altUnavailable;
        const on = hud[chip] && !disabled;
        const text = on ? formatChipValue(chip, readouts) : '--';
        // On-video pills abbreviate (HDG/ALT/SPD), so the aria-label carries
        // the full readout name and its value; the heading arrow encodes the
        // heading as rotation only (WCAG 1.1.1).
        const ariaLabel = chipAriaLabel(chip, readouts, on, t);
        return (
          <button
            key={chip}
            type="button"
            className="hud-chip"
            aria-label={ariaLabel}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(chip)}
          >
            <span className="label">{abbreviated ? EXPORT_HUD_LABELS[chip] : names[chip]}</span>
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
