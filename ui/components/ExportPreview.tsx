'use client';

import { useEffect, useMemo, useRef } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { RenderConfig } from '../../src/config.js';
import { bootScene } from '../../src/renderer/boot.js';
import type { Scene } from '../../src/renderer/scene.js';
import { restyleSceneData } from '../../src/restyle.js';
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
// rendered file contains and nothing of the source footage. The scene is
// created after mount against this host and restyled in place, like the
// player's map island; a ResizeObserver re-lays out whenever the box settles
// or changes, because the pane size may still be zero at creation time.
export function ExportPreview({ session, config, size, frame }: ExportPreviewProps) {
  const { width, height } = size;
  const data = useMemo(
    () =>
      restyleSceneData(
        session.scene,
        config,
        {
          fps: session.video.fps,
          frames: session.video.frames,
          tileBase: session.tileBase,
          bbox: session.bbox,
        },
        { width, height },
      ),
    [session, config, width, height],
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const dataRef = useRef(data);
  const frameRef = useRef(frame);

  // The boot effect below runs once, after the lazy Leaflet import settles;
  // syncing the latest props here keeps it from building the scene against
  // stale props without remounting the map.
  useEffect(() => {
    dataRef.current = data;
    frameRef.current = frame;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const observer = new ResizeObserver(() => sceneRef.current?.relayout());
    observer.observe(host);
    void (async () => {
      const { default: L } = await import('leaflet');
      if (cancelled) return;
      const created = bootScene(host, dataRef.current, L);
      sceneRef.current = created;
      created.setFrame(frameRef.current);
    })();
    return () => {
      cancelled = true;
      observer.disconnect();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(data);
  }, [data]);

  useEffect(() => {
    sceneRef.current?.setFrame(frame);
  }, [frame]);

  return (
    <div className="export-preview">
      <div className="export-preview-head">
        <span className="preview-title">Output preview</span>
        <span className="preview-state">{`${width}×${height}`}</span>
      </div>
      {/* The box is the output's exact shape, capped by width so the frame
          keeps room for the form at compact window heights. */}
      <div
        className="export-preview-frame"
        style={{
          aspectRatio: `${width} / ${height}`,
          width: `min(100%, calc(300px * ${width} / ${height}))`,
        }}
      >
        <div className="scene-host" style={{ isolation: 'isolate' }} ref={hostRef} />
      </div>
      <p className="export-preview-note">Export renders the map, not the source video.</p>
    </div>
  );
}
