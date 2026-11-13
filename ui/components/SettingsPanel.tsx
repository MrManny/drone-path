'use client';

import { useId } from 'react';

import { asTrailColor, MAP_STYLE_VALUES } from '../../src/config.js';
import type { MapStyle, RenderConfig, ViewMode } from '../../src/config.js';
import { patchConfig, setHudChip, STYLE_LABELS, VIEW_LABELS } from '../lib/settings.js';
import { ColorField } from './ColorField.js';
import { Notice } from './Notice.js';
import { NumberField } from './NumberField.js';
import { SelectField } from './SelectField.js';

export interface SettingsPanelProps {
  config: RenderConfig;
  hasAltitude: boolean;
  onChange: (config: RenderConfig) => void;
}

const HUD_CHIPS: Array<{ chip: 'heading' | 'alt' | 'speed'; label: string }> = [
  { chip: 'heading', label: 'Heading arrow' },
  { chip: 'alt', label: 'Altitude (ALT)' },
  { chip: 'speed', label: 'Speed (SPD)' },
];

const VIEW_CHOICES: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: 'overview', label: VIEW_LABELS.overview },
  { value: 'follow', label: VIEW_LABELS.follow },
];

export function SettingsPanel({ config, hasAltitude, onChange }: SettingsPanelProps) {
  const viewHintId = useId();
  const apply = (patch: Parameters<typeof patchConfig>[1]): boolean => {
    const next = patchConfig(config, patch);
    if (!next) return false;
    onChange(next);
    return true;
  };

  return (
    <div className="map-appearance">
      <p className="map-appearance-desc">
        Customize how your flight path appears in the preview and map export.
      </p>
      <fieldset className="settings-group">
        <legend>Map</legend>
        <SelectField
          label="Map style"
          value={config.style}
          options={MAP_STYLE_VALUES.map((value) => ({ value, label: STYLE_LABELS[value] }))}
          hint="Satellite imagery"
          onValue={(style) => apply({ style: style as MapStyle })}
        />
        <ColorField
          label="Trail color"
          value={config.trailColor}
          parse={(raw) => asTrailColor(raw, 'trail color')}
          rule="hex like #e63946"
          hint="empty = map style's color"
          onValue={(trailColor) => apply({ trailColor })}
        />
        <div className="settings-row">
          <span className="settings-label">View</span>
          <div className="segmented" role="group" aria-label="View" aria-describedby={viewHintId}>
            {VIEW_CHOICES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className="segment"
                aria-pressed={config.view === value}
                onClick={() => apply({ view: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="hint" id={viewHintId}>
            Camera framing
          </span>
        </div>
        <NumberField
          label="Zoom"
          value={config.zoom}
          min={0}
          rule="0 or more"
          hint="0 = auto-fit"
          onValue={(zoom) => apply({ zoom })}
        />
        <NumberField
          label="Zoom-out"
          value={config.zoomOut}
          min={0}
          rule="0 or more"
          hint="auto-fit only"
          onValue={(zoomOut) => apply({ zoomOut })}
        />
        <NumberField
          label="Intro (s)"
          value={config.introSec}
          min={0}
          rule="0 or more"
          step={0.5}
          onValue={(introSec) => apply({ introSec })}
        />
        <NumberField
          label="Outro (s)"
          value={config.outroSec}
          min={0}
          rule="0 or more"
          step={0.5}
          onValue={(outroSec) => apply({ outroSec })}
        />
      </fieldset>

      <fieldset className="settings-group">
        <legend>HUD chips</legend>
        {HUD_CHIPS.map(({ chip, label }) => {
          const altUnavailable = chip === 'alt' && !hasAltitude;
          return (
            <label key={chip} className="settings-row">
              <input
                type="checkbox"
                checked={config.hud[chip] && !altUnavailable}
                disabled={altUnavailable}
                title={
                  altUnavailable
                    ? 'Altitude unavailable in this telemetry'
                    : undefined
                }
                onChange={(e) =>
                  apply({ hud: setHudChip(config.hud, chip, e.target.checked) })
                }
              />
              <span>{label}</span>
            </label>
          );
        })}
        {hasAltitude ? null : (
          <Notice tone="warning">
            This recording has no altitude telemetry, so the ALT chip stays off.
          </Notice>
        )}
      </fieldset>
    </div>
  );
}
