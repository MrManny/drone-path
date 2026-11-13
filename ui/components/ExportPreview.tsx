'use client';

import type { CSSProperties } from 'react';
import { useMemo } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { RenderConfig } from '../../src/config.js';
import { restyleSceneData } from '../../src/restyle.js';
import { useSceneIsland } from '../hooks/useSceneIsland.js';
import { restyleMeta } from '../lib/restylemeta.js';
import 'leaflet/dist/leaflet.css';

export interface ExportPreviewProps {
  session: UiSession;
  config: RenderConfig;
  size: { width: number; height: number };
  frame: number;
  /** Shows the map-only rule at the decision point (the form phase), once per flow. */
  note?: boolean;
}

export function ExportPreview({ session, config, size, frame, note = false }: ExportPreviewProps) {
  const { width, height } = size;
  const { style, trailColor, view, zoom, zoomOut, introSec, outroSec, hud } = config;
  const data = useMemo(
    () =>
      restyleSceneData(
        session.scene,
        { style, trailColor, view, zoom, zoomOut, introSec, outroSec, hud },
        restyleMeta(session),
        { width, height },
      ),
    [session, style, trailColor, view, zoom, zoomOut, introSec, outroSec, hud, width, height],
  );
  const hostRef = useSceneIsland({ data, frame });

  return (
    <div className="export-preview">
      <div className="export-preview-head">
        <span className="preview-title">Output preview</span>
        <span className="preview-state">{`${width}×${height}`}</span>
      </div>
      <div
        className="export-preview-frame"
        style={
          {
            aspectRatio: `${width} / ${height}`,
            '--export-preview-cap': `calc(300px * ${width} / ${height})`,
          } as CSSProperties
        }
      >
        <div className="scene-host" style={{ isolation: 'isolate' }} ref={hostRef} />
      </div>
      {note ? (
        <p className="export-preview-note">Export captures the map, not the source recording.</p>
      ) : null}
    </div>
  );
}
