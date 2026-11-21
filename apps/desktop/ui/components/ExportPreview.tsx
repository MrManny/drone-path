'use client';

import { useTranslation } from '../lib/i18n.js';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { RenderConfig } from 'drone-path-engine/config';
import { useSceneIsland } from '../hooks/useSceneIsland.js';
import { restyleSession } from '../lib/restylemeta.js';
import 'leaflet/dist/leaflet.css';

interface ExportPreviewProps {
  session: UiSession;
  config: RenderConfig;
  size: { width: number; height: number };
  frame: number;
  /** Shows the map-only rule at the decision point (the form phase), once per flow. */
  note?: boolean;
}

export function ExportPreview({ session, config, size, frame, note = false }: ExportPreviewProps) {
  const t = useTranslation();
  const { width, height } = size;
  const data = useMemo(
    () => restyleSession(session, config, { width, height }),
    [session, config, width, height],
  );
  const hostRef = useSceneIsland({ data, frame });

  return (
    <div className="export-preview">
      <div className="export-preview-head">
        <span className="preview-title">{t('exportPreview.outputPreview')}</span>
        <span className="readout">{`${width}×${height}`}</span>
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
        <p className="export-preview-note">{t('exportPreview.mapOnly')}</p>
      ) : null}
    </div>
  );
}
