'use client';

import { useId } from 'react';

import { SHOT_TYPES } from 'drone-path-core/shot-segmentation';
import type { ShotType } from 'drone-path-core/shot-segmentation';
import { leafName } from '../../shared/errors.js';
import type { ArchiveFilterState } from '../hooks/useArchiveWorkspace.js';
import { useTranslation } from '../lib/i18n.js';

export interface ArchiveFilterRailProps {
  filters: ArchiveFilterState;
  roots: readonly string[];
  flightIds: readonly string[];
  activeCount: number;
  onChange: (next: ArchiveFilterState) => void;
  onClear: () => void;
}

export function ArchiveFilterRail({
  filters,
  roots,
  flightIds,
  activeCount,
  onChange,
  onClear,
}: ArchiveFilterRailProps) {
  const t = useTranslation();
  const baseId = useId();
  const afterId = `${baseId}-after`;
  const beforeId = `${baseId}-before`;
  const folderId = `${baseId}-folder`;
  const flightSelectId = `${baseId}-flight`;
  const distanceId = `${baseId}-distance`;
  const shotTypeId = `${baseId}-shot`;
  const smoothnessId = `${baseId}-smoothness`;

  const shotLabels: Record<ShotType, string> = {
    takeoff: t('archiveFilters.shotTakeoff'),
    landing: t('archiveFilters.shotLanding'),
    hover: t('archiveFilters.shotHover'),
    'smooth-glide': t('archiveFilters.shotSmoothGlide'),
    orbit: t('archiveFilters.shotOrbit'),
    'gimbal-reveal': t('archiveFilters.shotGimbalReveal'),
    reposition: t('archiveFilters.shotReposition'),
  };

  return (
    <div className="archive-filter-rail" role="region" aria-label={t('archiveFilters.heading')}>
      <div className="archive-filter-grid">
        <label className="archive-filter-field" htmlFor={afterId}>
          <span className="archive-filter-label">{t('archiveFilters.afterDate')}</span>
          <input
            id={afterId}
            type="date"
            value={filters.afterDate}
            onChange={(event) => onChange({ ...filters, afterDate: event.target.value })}
          />
        </label>

        <label className="archive-filter-field" htmlFor={beforeId}>
          <span className="archive-filter-label">{t('archiveFilters.beforeDate')}</span>
          <input
            id={beforeId}
            type="date"
            value={filters.beforeDate}
            onChange={(event) => onChange({ ...filters, beforeDate: event.target.value })}
          />
        </label>

        <label className="archive-filter-field" htmlFor={folderId}>
          <span className="archive-filter-label">{t('archiveFilters.folder')}</span>
          <select
            id={folderId}
            value={filters.folderRoot}
            onChange={(event) => onChange({ ...filters, folderRoot: event.target.value })}
          >
            <option value="">{t('archiveFilters.allFolders')}</option>
            {roots.map((root) => (
              <option key={root} value={root} title={root}>
                {leafName(root) || root}
              </option>
            ))}
          </select>
        </label>

        <label className="archive-filter-field" htmlFor={flightSelectId}>
          <span className="archive-filter-label">{t('archiveFilters.flight')}</span>
          <select
            id={flightSelectId}
            value={filters.flightId}
            onChange={(event) => onChange({ ...filters, flightId: event.target.value })}
          >
            <option value="">{t('archiveFilters.allFlights')}</option>
            {flightIds.map((id, index) => (
              <option key={id} value={id}>
                {t('archiveWorkspace.flightHeading', { index: index + 1 })}
              </option>
            ))}
          </select>
        </label>

        <div className="archive-filter-field">
          <label className="archive-filter-label" htmlFor={distanceId}>
            {t('archiveFilters.minDistance')}
          </label>
          <div className="archive-filter-distance">
            <input
              id={distanceId}
              type="number"
              min={0}
              step={10}
              placeholder="0"
              value={filters.minDistanceM}
              onChange={(event) => onChange({ ...filters, minDistanceM: event.target.value })}
            />
            <span className="field-unit">{t('archiveFilters.metersUnit')}</span>
          </div>
        </div>

        <label className="archive-filter-field" htmlFor={shotTypeId}>
          <span className="archive-filter-label">{t('archiveFilters.shotType')}</span>
          <select
            id={shotTypeId}
            value={filters.segmentType}
            onChange={(event) =>
              onChange({ ...filters, segmentType: event.target.value as ShotType | '' })
            }
          >
            <option value="">{t('archiveFilters.allShotTypes')}</option>
            {SHOT_TYPES.map((shot) => (
              <option key={shot} value={shot}>
                {shotLabels[shot]}
              </option>
            ))}
          </select>
        </label>

        <div className="archive-filter-field archive-filter-field-wide">
          <div className="archive-filter-range-head">
            <label className="archive-filter-label" htmlFor={smoothnessId}>
              {t('archiveFilters.minSmoothness')}
            </label>
            <span className="readout">
              {filters.minSmoothness > 0
                ? filters.minSmoothness.toFixed(2)
                : t('archiveFilters.anySmoothness')}
            </span>
          </div>
          <input
            id={smoothnessId}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={filters.minSmoothness}
            onChange={(event) =>
              onChange({ ...filters, minSmoothness: Number(event.target.value) })
            }
          />
        </div>
      </div>

      <div className="archive-filter-footer">
        <label className="settings-row toggle-row archive-filter-viewport-toggle">
          <input
            type="checkbox"
            className="toggle"
            checked={filters.onlyInMapView}
            onChange={(event) =>
              onChange({ ...filters, onlyInMapView: event.target.checked })
            }
          />
          <span>{t('archiveFilters.onlyInMapView')}</span>
        </label>

        <button
          type="button"
          className="archive-filter-clear"
          disabled={activeCount === 0}
          onClick={onClear}
        >
          {t('archiveFilters.clear')}
        </button>
      </div>
    </div>
  );
}
