'use client';

import { useMemo, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { hasAltitude } from '../../src/config.js';
import type { ConfigOverrides, RenderConfig } from '../../src/config.js';
import { restyleSceneData } from '../../src/restyle.js';
import type { HudChipId } from '../lib/chipreadouts.js';
import { chipReadoutsAt } from '../lib/chipreadouts.js';
import { previewFrame } from '../lib/exportstate.js';
import { EXAMPLE_FLIGHT } from '../lib/exampleflight.js';
import { defaultAppearance, patchConfig, setHudChip } from '../lib/settings.js';
import { restyleMeta } from '../lib/restylemeta.js';
import { CameraControls } from './CameraControls.js';
import { DialogShell } from './DialogShell.js';
import { HudChips } from './HudChips.js';
import { MapAppearancePreview } from './MapAppearancePreview.js';
import { MapStyleTiles } from './MapStyleTiles.js';
import { Notice } from './Notice.js';
import { OpeningEndingStrip } from './OpeningEndingStrip.js';
import type { PreviewSegment } from './OpeningEndingStrip.js';
import { TrailColorSwatches } from './TrailColorSwatches.js';

const PREVIEW_SIZE = { width: 1280, height: 720 };

interface MapAppearanceModalProps {
  /** Without a recording the preview draws the bundled example flight. */
  session: UiSession | null;
  config: RenderConfig;
  onChange: (config: RenderConfig) => void;
  onClose: () => void;
}

/** Map appearance as a modal around a live preview: every change shows in
    the preview at once and applies to the map and future exports. */
export function MapAppearanceModal({ session, config, onChange, onClose }: MapAppearanceModalProps) {
  const [segment, setSegment] = useState<PreviewSegment>('flight');

  const appearance = useMemo(() => {
    const { style, view, zoom, zoomOut, introSec, outroSec, trailColor, hud } = config;
    return { style, view, zoom, zoomOut, introSec, outroSec, trailColor, hud };
  }, [config]);

  const preview = useMemo(() => {
    const base = session === null ? EXAMPLE_FLIGHT.baseScene : session.scene;
    const meta = session === null ? EXAMPLE_FLIGHT.meta : restyleMeta(session);
    const data = restyleSceneData(base, appearance, meta, PREVIEW_SIZE);
    // The chips over the preview stand in for the export frame's HUD pills,
    // so the renderer draws none of its own.
    return { ...data, hud: { ...data.hud, alt: false, speed: false } };
  }, [session, appearance]);

  const frames = session === null ? EXAMPLE_FLIGHT.frames : session.video.frames;
  const flightSec = session === null ? EXAMPLE_FLIGHT.durationSec : session.durationSec;
  const frame =
    segment === 'intro'
      ? 0
      : segment === 'outro'
        ? Math.max(0, frames - 1)
        : previewFrame(null, frames);
  const readouts = chipReadoutsAt(preview, frame);
  const altUnavailable = session !== null && !hasAltitude(session.scene.alt);

  const apply = (patch: ConfigOverrides): boolean => {
    const next = patchConfig(config, patch);
    if (!next) return false;
    onChange(next);
    return true;
  };
  const toggleChip = (chip: HudChipId): void => {
    apply({ hud: setHudChip(config.hud, chip, !config.hud[chip]) });
  };

  return (
    <DialogShell title="Map appearance" onClose={onClose} panelClass="map-appearance-panel">
      <p className="map-appearance-desc">Every change shows in the preview at once.</p>
      <div className="map-appearance-body">
        <div className="map-appearance-main">
          <MapAppearancePreview
            data={preview}
            frame={frame}
            isExample={session === null}
            hud={config.hud}
            readouts={readouts}
            altUnavailable={altUnavailable}
            onToggleChip={toggleChip}
          />
          <OpeningEndingStrip
            introSec={config.introSec}
            outroSec={config.outroSec}
            flightSec={flightSec}
            selected={segment}
            onSelect={setSegment}
            onChange={apply}
          />
        </div>
        <div className="map-appearance-cards">
          <fieldset className="settings-group">
            <legend>Map look</legend>
            <span className="group-label">Map style</span>
            <MapStyleTiles value={config.style} onChange={(style) => apply({ style })} />
            <span className="group-label">Trail color</span>
            <TrailColorSwatches
              value={config.trailColor}
              onChange={(trailColor) => apply({ trailColor })}
            />
          </fieldset>
          <fieldset className="settings-group">
            <legend>Camera</legend>
            <CameraControls
              view={config.view}
              zoom={config.zoom}
              framePadding={config.zoomOut}
              resolvedZoom={preview.zoom}
              style={config.style}
              onChange={apply}
            />
          </fieldset>
          <fieldset className="settings-group">
            <legend>On-frame readouts</legend>
            <HudChips
              hud={config.hud}
              readouts={readouts}
              altUnavailable={altUnavailable}
              onToggle={toggleChip}
            />
            <p className="hint">Click a chip here or in the preview — both stay in sync.</p>
            {altUnavailable ? (
              <Notice tone="warning">
                This recording has no altitude telemetry, so the ALT chip stays off and the map
                strip shows no Altitude value.
              </Notice>
            ) : null}
          </fieldset>
        </div>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          onClick={() => {
            onChange({ ...config, ...defaultAppearance() });
          }}
        >
          Restore defaults
        </button>
        <button type="button" className="dialog-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </DialogShell>
  );
}
