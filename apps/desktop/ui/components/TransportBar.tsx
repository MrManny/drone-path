'use client';

import { useTranslation } from '../lib/i18n.js';
import type { RefObject } from 'react';

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';

import { formatTimeReadout } from '../lib/frametime.js';
import type { HotkeyAction } from '../lib/hotkeys.js';

export interface TransportBarProps {
  dispatch?: (action: HotkeyAction) => void;
  disabled?: boolean;
  ready?: boolean;
  playing?: boolean;
  speed?: 1 | 2 | 3 | 4;
  fps?: number;
  durationSec?: number;
  timeRef?: RefObject<HTMLSpanElement | null>;
}

export function TransportBar({
  dispatch,
  disabled = false,
  ready = false,
  playing = false,
  speed = 1,
  fps = 0,
  durationSec = 0,
  timeRef,
}: TransportBarProps) {
  const t = useTranslation();
  return (
    <div className="transport">
      <span className={`readout transport-time${disabled ? ' readout-off' : ''}`} ref={timeRef}>
        {disabled ? '--' : formatTimeReadout(0, fps, durationSec)}
      </span>
      <div className="transport-group transport-cluster">
        <button
          type="button"
          className="transport-step"
          aria-label={t('transportBar.jumpToStart')}
          title={t('transportBar.jumpToStartHome')}
          disabled={disabled}
          onClick={() => dispatch?.({ type: 'seekStart' })}
        >
          <SkipBack size={16} />
        </button>
        <button
          type="button"
          className="transport-step"
          aria-label={ready && playing ? t('transportBar.pause') : t('transportBar.play')}
          title={ready && playing ? t('transportBar.pauseHint') : t('transportBar.playHint')}
          onClick={() => dispatch?.({ type: 'togglePlay' })}
          disabled={disabled || !ready}
        >
          {ready && playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          className="transport-step"
          aria-label={t('transportBar.jumpToEnd')}
          title={t('transportBar.jumpToEndEnd')}
          disabled={disabled}
          onClick={() => dispatch?.({ type: 'seekEnd' })}
        >
          <SkipForward size={16} />
        </button>
      </div>
      <div className="transport-group transport-speed">
        <span className="transport-label">{t('transportBar.playbackSpeed')}</span>
        <div className="segmented" role="group" aria-label={t('transportBar.playbackSpeed')}>
          {([1, 2, 3, 4] as const).map((rate) => (
            <button
              key={rate}
              type="button"
              className="segment"
              aria-pressed={speed === rate}
              title={t('transportBar.speedHint', { rate })}
              disabled={disabled}
              onClick={() => dispatch?.({ type: 'speed', rate })}
            >
              {rate}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
