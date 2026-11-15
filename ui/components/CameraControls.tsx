'use client';

import { useId } from 'react';

import type { ConfigOverrides, MapStyle, ViewMode } from '../../src/config.js';
import { zoomLimits } from '../../src/plan.js';
import { VIEW_LABELS } from '../lib/settings.js';

interface CameraControlsProps {
  view: ViewMode;
  /** The pinned zoom level; 0 means auto-fit. */
  zoom: number;
  framePadding: number;
  /** The level auto-fit resolves to for the flight in the preview. */
  resolvedZoom: number;
  style: MapStyle;
  onChange: (patch: ConfigOverrides) => boolean;
}

const VIEW_CHOICES: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: 'overview', label: VIEW_LABELS.overview },
  { value: 'follow', label: VIEW_LABELS.follow },
];

/** Camera framing: view, auto-fit zoom, the zoom level and frame padding. */
export function CameraControls({
  view,
  zoom,
  framePadding,
  resolvedZoom,
  style,
  onChange,
}: CameraControlsProps) {
  const zoomId = useId();
  const paddingId = useId();
  const autoFit = zoom === 0;
  const { min: zoomMin, max: zoomMax } = zoomLimits(style);
  // A stored padding above the slider range (possible from a config file)
  // keeps its true value until the slider is actually edited.
  const paddingMax = Math.max(10, framePadding);

  return (
    <div>
      <div className="settings-row">
        <span className="settings-label">View</span>
        <div className="segmented" role="group" aria-label="View">
          {VIEW_CHOICES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className="segment"
              aria-pressed={view === value}
              onClick={() => onChange({ view: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="settings-row toggle-row">
        <input
          type="checkbox"
          className="toggle"
          checked={autoFit}
          onChange={(e) => onChange({ zoom: e.target.checked ? 0 : resolvedZoom })}
        />
        <span>Auto-fit zoom</span>
      </label>
      <div className="settings-row">
        <label className="settings-label" htmlFor={zoomId}>
          Zoom level
        </label>
        <input
          id={zoomId}
          type="range"
          min={zoomMin}
          max={zoomMax}
          step={1}
          value={autoFit ? resolvedZoom : zoom}
          disabled={autoFit}
          aria-valuetext={autoFit ? `auto-fit → ${resolvedZoom}` : String(zoom)}
          aria-describedby={`${zoomId}-readout`}
          onChange={(e) => onChange({ zoom: Number(e.target.value) })}
        />
        <span className="range-readout" id={`${zoomId}-readout`}>
          {autoFit ? `auto-fit → ${resolvedZoom}` : String(zoom)}
        </span>
      </div>
      <div className="settings-row">
        <label className="settings-label" htmlFor={paddingId}>
          Frame padding
        </label>
        <input
          id={paddingId}
          type="range"
          min={0}
          max={paddingMax}
          step={1}
          value={framePadding}
          disabled={!autoFit}
          aria-valuetext={`${framePadding} ${framePadding === 1 ? 'level' : 'levels'}`}
          aria-describedby={
            autoFit ? `${paddingId}-readout` : `${paddingId}-readout ${paddingId}-hint`
          }
          onChange={(e) => onChange({ zoomOut: Number(e.target.value) })}
        />
        <span className="range-readout" id={`${paddingId}-readout`}>
          {`${framePadding} ${framePadding === 1 ? 'level' : 'levels'}`}
        </span>
        {autoFit ? null : (
          <span className="hint" id={`${paddingId}-hint`}>
            auto-fit only
          </span>
        )}
      </div>
    </div>
  );
}
