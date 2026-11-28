'use client';

import { useState } from 'react';
import { ChevronDown, Film, FolderOpen } from 'lucide-react';

import { archivePosterUrlFor } from '../../shared/appurls.js';
import { leafName } from '../../shared/errors.js';
import type { ArchiveFlightClipDto, ArchiveFlightDto } from '../../shared/ipc.js';
import { formatArchiveDistance } from '../lib/archivedistance.js';
import { formatTime } from '../lib/frametime.js';
import { useTranslation } from '../lib/i18n.js';

type Clip = ArchiveFlightClipDto;

function Poster({ posterId, onError }: { posterId?: string; onError: () => void }) {
  return (
    <span className={`archive-clip-poster${posterId ? '' : ' archive-clip-poster-fallback'}`} aria-hidden="true">
      {posterId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="archive-clip-poster-img" src={archivePosterUrlFor(posterId)} alt="" loading="lazy" onError={onError} />
      ) : <Film aria-hidden="true" />}
    </span>
  );
}

function ClipBadge({ clip }: { clip: Clip }) {
  const t = useTranslation();
  if (clip.availability === 'offline') {
    return <span className="archive-badge archive-badge-offline">{t('archiveWorkspace.offlineBadge')}</span>;
  }
  if (clip.status === 'error') {
    return <span className="archive-badge archive-badge-error">{t('archiveWorkspace.errorBadge')}</span>;
  }
  if (clip.status === 'no-telemetry' || clip.status === 'no-gps') {
    return <span className="archive-badge">{t('archiveWorkspace.noTelemetryBadge')}</span>;
  }
  if (clip.telemetry && clip.telemetry.fixCount > 0) {
    return <span className="archive-badge">{t('archiveWorkspace.gpsTrack')}</span>;
  }
  return null;
}

interface ClipActions {
  opening: boolean;
  selectedClipPath: string | null;
  onSelectClip: (path: string) => void;
  onOpenClip: (path: string) => void;
  onRevealClip: (path: string) => void;
}

function clipButton(clip: Clip, actions: ClipActions, t: ReturnType<typeof useTranslation>) {
  const name = leafName(clip.path);
  const offline = clip.availability === 'offline';
  return {
    type: 'button' as const,
    disabled: actions.opening || offline,
    'aria-label': offline ? t('archiveWorkspace.offlineClipLabel', { name }) : t('archiveWorkspace.openClip', { name }),
    'data-selected': actions.selectedClipPath === clip.path ? 'true' : undefined,
    'data-archive-clip': clip.path,
    title: offline ? t('archiveWorkspace.offlineClipHint', { path: clip.path }) : undefined,
    onFocus: () => actions.onSelectClip(clip.path),
    onMouseEnter: () => actions.onSelectClip(clip.path),
    onClick: () => {
      actions.onSelectClip(clip.path);
      actions.onOpenClip(clip.path);
    },
  };
}

function RevealClip({ clip, onRevealClip }: { clip: Clip; onRevealClip: ClipActions['onRevealClip'] }) {
  const t = useTranslation();
  return (
    <button type="button" className="archive-clip-reveal"
      aria-label={t('archiveWorkspace.revealClipLabel', { name: leafName(clip.path) })}
      title={t('archiveWorkspace.revealClip')} disabled={clip.availability === 'offline'}
      onClick={() => onRevealClip(clip.path)}>
      <FolderOpen aria-hidden="true" />
    </button>
  );
}

interface ArchiveFlightCardProps extends ClipActions {
  flight: ArchiveFlightDto;
  index: number;
  matches: ReadonlySet<string> | null;
  expanded: boolean;
  onToggle: () => void;
}

export function ArchiveFlightCard({ flight, index, matches, expanded, onToggle, ...actions }: ArchiveFlightCardProps) {
  const t = useTranslation();
  const [failedPosters, setFailedPosters] = useState<ReadonlySet<string>>(() => new Set());
  const { clips } = flight;
  const candidates = matches ? clips.filter(({ path }) => matches.has(path)) : clips;
  const representative = candidates.find(({ posterId }) => posterId && !failedPosters.has(posterId)) ?? candidates[0];
  const { posterId } = representative;
  const name = leafName(representative.path);
  const multiple = clips.length > 1;
  const label = t('archiveWorkspace.flightHeading', { index: index + 1 });
  const selected = clips.some(({ path }) => path === actions.selectedClipPath);
  const totalDuration = clips.reduce((sum, clip) => sum + (clip.video?.durationSec ?? 0), 0);
  const allOffline = clips.every(({ availability }) => availability === 'offline');
  const allGps = clips.every(({ telemetry }) => telemetry && telemetry.fixCount > 0);
  const allNoGps = clips.every(({ status }) => status === 'no-telemetry' || status === 'no-gps');

  return (
    <li className={`archive-flight${selected ? ' is-selected' : ''}`}>
      <div className="archive-flight-summary">
        <button className={`archive-flight-button${allOffline && !multiple ? ' is-offline' : ''}`}
          {...(multiple ? {
            type: 'button' as const,
            'aria-label': t('archiveWorkspace.flightClips', { flight: label }),
            'aria-expanded': expanded,
            onClick: onToggle,
          } : clipButton(representative, actions, t))}>
          <Poster posterId={posterId && !failedPosters.has(posterId) ? posterId : undefined}
            onError={() => posterId && setFailedPosters((previous) => new Set([...previous, posterId]))} />
          <span className="archive-flight-details">
            <span className="archive-flight-title">{label}</span>
            <span className="archive-flight-meta readout">
              <span>{t('archiveWorkspace.clipCount', { count: clips.length })}</span>
              {totalDuration > 0 ? <span><span aria-hidden="true">{' · '}</span><span>{formatTime(totalDuration)}</span></span> : null}
            </span>
            <span className="archive-clip-name" title={name}>{name}</span>
            {multiple ? (
              <>
                {allOffline ? <span className="archive-badge archive-badge-offline">{t('archiveWorkspace.offlineBadge')}</span> : null}
                {allGps || allNoGps ? <span className="archive-badge">{allGps ? t('archiveWorkspace.gpsTrack') : t('archiveWorkspace.noTelemetryBadge')}</span> : null}
                {matches ? <span className="archive-flight-match">{t('archiveWorkspace.filenameMatches', { count: matches.size })}</span> : null}
              </>
            ) : <ClipBadge clip={representative} />}
          </span>
          {multiple ? <ChevronDown className="archive-flight-chevron" aria-hidden="true" /> : null}
        </button>
        {multiple ? null : <RevealClip clip={representative} onRevealClip={actions.onRevealClip} />}
      </div>
      {multiple && expanded ? (
        <ul className="archive-clip-list">
          {clips.map((clip) => {
            const clipName = leafName(clip.path);
            const matching = matches?.has(clip.path);
            const duration = clip.video?.durationSec ?? null;
            return (
              <li key={clip.path} className={`archive-clip-card${actions.selectedClipPath === clip.path ? ' is-selected' : ''}`}>
                <button className={`archive-clip-row${clip.availability === 'offline' ? ' archive-clip-row-offline' : ''}`}
                  {...clipButton(clip, actions, t)}>
                  <span className="archive-clip-main">
                    <span className="archive-clip-name" title={clipName}>{clipName}</span>
                    <span className="archive-clip-subline">
                      <span className="readout">
                        <span>{duration === null ? '--' : formatTime(duration)}</span>
                        <span aria-hidden="true">{' · '}</span>
                        <span>{clip.telemetry ? formatArchiveDistance(clip.telemetry.trackDistanceM, t) : '--'}</span>
                      </span>
                      <ClipBadge clip={clip} />
                      {matching ? <span className="archive-flight-match">{t('archiveWorkspace.filenameMatch')}</span> : null}
                    </span>
                  </span>
                </button>
                <RevealClip clip={clip} onRevealClip={actions.onRevealClip} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
