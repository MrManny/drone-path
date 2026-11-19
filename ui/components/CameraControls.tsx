'use client';

import { useTranslation } from '../lib/i18n.js';
import { useId } from 'react';

import type { ConfigOverrides, MapStyle, ViewMode } from '../../src/config.js';
import { zoomLimits } from '../../src/plan.js';
import { viewLabels } from '../lib/settings.js';

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

const VIEW_CHOICES: readonly ViewMode[] = ['overview', 'follow'];

/** Camera framing: view, auto-fit zoom, the zoom level and frame padding. */
export function CameraControls({
  view,
  zoom,
  framePadding,
  resolvedZoom,
  style,
  onChange,
}: CameraControlsProps) {
  const t = useTranslation();
  const labels = viewLabels(t);
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
        <span className="settings-label">{t('cameraControls.view')}</span>
        <div className="segmented" role="group" aria-label={t('cameraControls.view')}>
          {VIEW_CHOICES.map((value) => (
            <button
              key={value}
              type="button"
              className="segment"
              aria-pressed={view === value}
              onClick={() => onChange({ view: value })}
            >
              {labels[value]}
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
        <span>{t('cameraControls.autoFitZoom')}</span>
      </label>
      <div className="settings-row">
        <label className="settings-label" htmlFor={zoomId}>
          {t('cameraControls.zoomLevel')}
        </label>
        <input
          id={zoomId}
          type="range"
          min={zoomMin}
          max={zoomMax}
          step={1}
          value={autoFit ? resolvedZoom : zoom}
          disabled={autoFit}
          aria-valuetext={autoFit ? t('cameraControls.resolvedZoom', { zoom: resolvedZoom }) : String(zoom)}
          aria-describedby={`${zoomId}-readout`}
          onChange={(e) => onChange({ zoom: Number(e.target.value) })}
        />
        <span className="range-readout" id={`${zoomId}-readout`}>
          {autoFit ? t('cameraControls.resolvedZoom', { zoom: resolvedZoom }) : String(zoom)}
        </span>
      </div>
      <div className="settings-row">
        <label className="settings-label" htmlFor={paddingId}>
          {t('cameraControls.framePadding')}
        </label>
        <input
          id={paddingId}
          type="range"
          min={0}
          max={paddingMax}
          step={1}
          value={framePadding}
          disabled={!autoFit}
          aria-valuetext={t('cameraControls.paddingLevels', { count: framePadding })}
          aria-describedby={
            autoFit ? `${paddingId}-readout` : `${paddingId}-readout ${paddingId}-hint`
          }
          onChange={(e) => onChange({ zoomOut: Number(e.target.value) })}
        />
        <span className="range-readout" id={`${paddingId}-readout`}>
          {t('cameraControls.paddingLevels', { count: framePadding })}
        </span>
        {autoFit ? null : (
          <span className="hint" id={`${paddingId}-hint`}>
            {t('cameraControls.autoFitOnly')}
          </span>
        )}
      </div>
    </div>
  );
}
