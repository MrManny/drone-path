'use client';

import { useTranslation } from '../lib/i18n.js';

export interface ZoomReadoutProps {
  /** The pinned "Zoom level" setting: 0 is auto-fit. */
  zoom: number;
  /** The level the map currently shows, as planned for the preview. */
  visibleZoom: number;
  /** A refused step's reason, announced through the readout's live region. */
  notice?: string;
}

/** The zoom-level readout with its live region: the level the map renders
    (auto-fit says so instead) and a refused step's reason, announced even in
    the PiP strip where the stepper stays out (#287). */
export function ZoomReadout({ zoom, visibleZoom, notice = '' }: ZoomReadoutProps) {
  const t = useTranslation();
  // The readout states the level the map renders; auto-fit says so instead.
  const level = zoom === 0 ? t('zoomReadout.autoFit') : String(visibleZoom);
  return (
    <span className="map-zoom-level" aria-live="polite" aria-atomic="true">
      <span className="sr-only">{t('zoomReadout.zoomLabel')}</span>
      {level}
      {notice ? <span className="sr-only">. {notice}</span> : null}
    </span>
  );
}
