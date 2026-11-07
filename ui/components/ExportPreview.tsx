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
  /** The look the export runs with: the frozen request config while a job runs. */
  config: RenderConfig;
  /** The committed output size; the frame box keeps exactly this aspect ratio. */
  size: { width: number; height: number };
  /** Representative frame of the export selection. */
  frame: number;
}

// The map-only output preview: the shared scene — the very renderer the export
// captures — planned at the output size, so the box shows exactly what the
// rendered file contains and nothing of the source footage.
export function ExportPreview({ session, config, size, frame }: ExportPreviewProps) {
  const { width, height } = size;
  // Keyed on the fields the scene plan actually reads: encoder edits never
  // re-plan the scene.
  const { style, view, zoom, zoomOut, introSec, outroSec, hud } = config;
  const data = useMemo(
    () =>
      restyleSceneData(
        session.scene,
        { style, view, zoom, zoomOut, introSec, outroSec, hud },
        restyleMeta(session),
        { width, height },
      ),
    [session, style, view, zoom, zoomOut, introSec, outroSec, hud, width, height],
  );
  const hostRef = useSceneIsland({ data, frame });

  return (
    <div className="export-preview">
      <div className="export-preview-head">
        <span className="preview-title">Output preview</span>
        <span className="preview-state">{`${width}×${height}`}</span>
      </div>
      {/* The box is the output's exact shape; its width cap (resolved in
          .export-preview-frame) keeps the frame at most 300px tall so the form
          keeps room at compact window heights. */}
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
      <p className="export-preview-note">Export renders the map, not the source video.</p>
    </div>
  );
}
