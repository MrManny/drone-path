'use client';

import { useTranslation } from '../lib/i18n.js';
import type { MapStyle } from 'drone-path-engine/config';
import { zoomLimits } from 'drone-path-engine/plan';
import { ZoomReadout } from './ZoomReadout.js';

export interface ZoomStepperProps {
  /** The pinned "Zoom level" setting: 0 is auto-fit. */
  zoom: number;
  /** The level the map currently shows, as planned for the preview. */
  visibleZoom: number;
  style: MapStyle;
  onStep: (delta: 1 | -1) => void;
  /** A refused step's reason, announced through the readout's live region. */
  notice?: string;
}

export function ZoomStepper({ zoom, visibleZoom, style, onStep, notice = '' }: ZoomStepperProps) {
  const t = useTranslation();
  const { min, max } = zoomLimits(style);
  const canOut = visibleZoom > min;
  const canIn = visibleZoom < max;
  // At a limit the buttons stay focusable through aria-disabled, so the
  // keyboard highlight and the reason in the title get announced (#271).
  // The stepper is bare: no pill container and no button borders (#272).
  return (
    <div className="map-zoom-stepper" role="group" aria-label={t('zoomStepper.zoomLevel')}>
      <button
        type="button"
        aria-label={t('zoomStepper.zoomOut')}
        aria-disabled={canOut ? undefined : 'true'}
        title={canOut ? t('zoomStepper.zoomOutHint') : t('zoomStepper.alreadyAtMinimum')}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <ZoomReadout zoom={zoom} visibleZoom={visibleZoom} notice={notice} />
      <button
        type="button"
        aria-label={t('zoomStepper.zoomIn')}
        aria-disabled={canIn ? undefined : 'true'}
        title={canIn ? t('zoomStepper.zoomInHint') : t('zoomStepper.alreadyAtMaximum')}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </div>
  );
}
