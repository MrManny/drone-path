'use client';

import { useEffect, useRef } from 'react';
import { MapPin, Navigation, Video, X } from 'lucide-react';

import type { LatLon } from 'drone-path-core/geo';
import { leafName } from '../../shared/errors.js';
import type { ArchiveNearHit } from '../../shared/ipc.js';
import { formatArchiveDistance } from '../lib/archivedistance.js';
import { formatTime } from '../lib/frametime.js';
import { useTranslation } from '../lib/i18n.js';

export interface ArchivePointPopoverProps {
  coord: LatLon;
  hits: readonly ArchiveNearHit[] | null;
  loading: boolean;
  onOpenClip?: (clipPath: string, seekSec?: number) => void;
  onClose: () => void;
}

function formatCoord(coord: LatLon): string {
  return `${coord.lat.toFixed(5)}, ${coord.lon.toFixed(5)}`;
}

export function ArchivePointPopover({
  coord,
  hits,
  loading,
  onOpenClip,
  onClose,
}: ArchivePointPopoverProps) {
  const t = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [coord.lat, coord.lon]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="archive-point-popover"
      role="region"
      aria-label={t('archivePointPopover.regionLabel')}
      tabIndex={-1}
    >
      <div className="archive-point-popover-head">
        <div className="archive-point-popover-title-wrap">
          <div className="archive-point-popover-title-row">
            <MapPin size={15} aria-hidden="true" className="archive-point-popover-pin" />
            <h3 className="archive-point-popover-title">{t('archivePointPopover.title')}</h3>
          </div>
          <span className="archive-point-popover-coord readout">{formatCoord(coord)}</span>
        </div>
        <button
          type="button"
          className="archive-point-popover-close"
          aria-label={t('archivePointPopover.close')}
          title={t('archivePointPopover.close')}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {loading ? (
        <p className="hint archive-point-popover-status" role="status">
          {t('archivePointPopover.searching')}
        </p>
      ) : hits !== null && hits.length === 0 ? (
        <div className="archive-point-popover-empty" role="status">
          <p className="hint">{t('archivePointPopover.empty')}</p>
          <button type="button" className="archive-point-popover-dismiss" onClick={onClose}>
            {t('notice.dismiss')}
          </button>
        </div>
      ) : hits !== null ? (
        <ul className="archive-point-hit-list">
          {hits.map((hit, index) => {
            const name = leafName(hit.clip.path);
            const timeText = formatTime(hit.tSec);
            const distanceText = formatArchiveDistance(hit.distanceM, t);
            const isOffline = hit.clip.availability === 'offline';
            const isGaze = hit.matchType === 'gaze';
            const matchLabel = isGaze
              ? t('archivePointPopover.matchGaze')
              : t('archivePointPopover.matchTrack');

            return (
              <li key={`${hit.clip.path}:${hit.matchType}:${hit.tSec}:${index}`}>
                <button
                  type="button"
                  className={`archive-point-hit${isOffline ? ' archive-point-hit-offline' : ''}`}
                  disabled={isOffline || !onOpenClip}
                  aria-label={
                    isOffline
                      ? t('archivePointPopover.offlineHitLabel', { name, time: timeText })
                      : t('archivePointPopover.openHit', { name, time: timeText })
                  }
                  onClick={() => {
                    if (!isOffline) onOpenClip?.(hit.clip.path, hit.tSec);
                  }}
                >
                  <div className="archive-point-hit-top">
                    <span className="archive-point-hit-name">{name}</span>
                    <span className="archive-point-hit-time readout">{timeText}</span>
                  </div>
                  <div className="archive-point-hit-badges">
                    <span
                      className={`archive-point-match-badge${isGaze ? ' is-gaze' : ' is-track'}`}
                    >
                      {isGaze ? (
                        <Video size={12} aria-hidden="true" />
                      ) : (
                        <Navigation size={12} aria-hidden="true" />
                      )}
                      {matchLabel}
                    </span>
                    <span className="archive-point-hit-distance readout">{distanceText}</span>
                    {isOffline ? (
                      <span className="archive-badge archive-badge-offline">
                        {t('archiveWorkspace.offlineBadge')}
                      </span>
                    ) : null}
                  </div>
                  {isOffline ? (
                    <span className="hint archive-point-hit-reason">
                      {t('archivePointPopover.offlineReason')}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
