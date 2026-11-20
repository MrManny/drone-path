'use client';

import { useTranslation } from '../lib/i18n.js';
import { useMemo, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { appearanceOf, hasAltitude } from 'drone-path-engine/config';
import type { ConfigOverrides, RenderConfig } from 'drone-path-engine/config';
import { planIntroOutroFrames } from 'drone-path-engine/plan';
import { restyleSceneData } from 'drone-path-engine/restyle';
import type { HudChipId } from '../lib/chipreadouts.js';
import { chipReadoutsAt } from '../lib/chipreadouts.js';
import { previewFrame } from '../lib/exportstate.js';
import { getExampleFlight } from '../lib/exampleflight.js';
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
  const t = useTranslation();
  const [segment, setSegment] = useState<PreviewSegment>('flight');
  const example = session === null ? getExampleFlight() : null;

  const appearance = useMemo(() => appearanceOf(config), [config]);

  const preview = useMemo(() => {
    const base = example ? example.baseScene : session!.scene;
    const meta = example ? example.meta : restyleMeta(session!);
    const data = restyleSceneData(base, appearance, meta, PREVIEW_SIZE);
    // The chips over the preview stand in for the export frame's HUD pills,
    // so the renderer draws none of its own; the real HUD flags stay on the
    // data because the marker arrow follows the heading setting (#283).
    return { ...data, hudPills: false };
  }, [session, example, appearance]);

  const fps = example ? example.fps : session!.video.fps;
  const frames = example ? example.frames : session!.video.frames;
  const flightSec = example ? example.durationSec : session!.durationSec;
  const shortened = planIntroOutroFrames(config, { fps, frames }).clamped;
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
    <DialogShell title={t('mapAppearanceModal.mapAppearance')} onClose={onClose} panelClass="map-appearance-panel">
      <p className="map-appearance-desc">{t('mapAppearanceModal.livePreviewHint')}</p>
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
            shortened={shortened}
            selected={segment}
            onSelect={setSegment}
            onChange={apply}
          />
        </div>
        <div className="map-appearance-cards">
          <fieldset className="settings-group">
            <legend>{t('mapAppearanceModal.mapLook')}</legend>
            <span className="group-label">{t('mapAppearanceModal.mapStyle')}</span>
            <MapStyleTiles value={config.style} onChange={(style) => apply({ style })} />
            <span className="group-label">{t('mapAppearanceModal.trailColor')}</span>
            <TrailColorSwatches
              value={config.trailColor}
              onChange={(trailColor) => apply({ trailColor })}
            />
          </fieldset>
          <fieldset className="settings-group">
            <legend>{t('mapAppearanceModal.camera')}</legend>
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
            <legend>{t('mapAppearanceModal.onFrameReadouts')}</legend>
            <HudChips
              hud={config.hud}
              readouts={readouts}
              altUnavailable={altUnavailable}
              onToggle={toggleChip}
            />
            <p className="hint">{t('mapAppearanceModal.chipHint')}</p>
            {altUnavailable ? (
              <Notice tone="warning">
                {t('mapAppearanceModal.altitudeUnavailable')}
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
          {t('mapAppearanceModal.restoreDefaults')}
        </button>
        <button type="button" className="dialog-primary" onClick={onClose}>
          {t('mapAppearanceModal.done')}
        </button>
      </div>
    </DialogShell>
  );
}
