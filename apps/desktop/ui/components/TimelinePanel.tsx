'use client';

import { useTranslation } from '../lib/i18n.js';
import { useEffect, useId, useRef } from 'react';
import type { RefObject } from 'react';

import { ArrowLeftFromLine, ArrowRightFromLine, X } from 'lucide-react';

import { formatLoopReadout, formatTime, formatTimeReadout, timelineTicks } from '../lib/frametime.js';
import type { HotkeyAction } from '../lib/hotkeys.js';
import type { LoopState } from '../lib/loop.js';
import { frameAtPointer, hasLoop, resolveLoop } from '../lib/loop.js';
import { Filmstrip } from './Filmstrip.js';

const NO_LOOP: LoopState = { in: null, out: null };

export interface TimelinePanelProps {
  dispatch?: (action: HotkeyAction) => void;
  disabled?: boolean;
  loop?: LoopState;
  setLoopFrame?: (which: 'in' | 'out', frame: number) => void;
  fps?: number;
  frames?: number;
  durationSec?: number;
  maxFrame?: number;
  scrubTo?: (i: number) => void;
  scrubRef?: RefObject<HTMLInputElement | null>;
  playheadRef?: RefObject<HTMLDivElement | null>;
  src?: string;
}

export function TimelinePanel({
  dispatch,
  disabled = false,
  loop = NO_LOOP,
  setLoopFrame,
  fps = 0,
  frames = 0,
  durationSec = 0,
  maxFrame = 0,
  scrubTo,
  scrubRef,
  playheadRef,
  src = '',
}: TimelinePanelProps) {
  const t = useTranslation();
  const headingId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const setLoopFrameRef = useRef(setLoopFrame);
  const maxFrameRef = useRef(maxFrame);

  useEffect(() => {
    setLoopFrameRef.current = setLoopFrame;
    maxFrameRef.current = maxFrame;
  });

  useEffect(() => () => dragCleanupRef.current?.(), []);

  useEffect(() => {
    if (disabled) dragCleanupRef.current?.();
  }, [disabled]);

  const bandPct = (i: number): number => (maxFrame > 0 ? (i / maxFrame) * 100 : 0);
  const loopPoints = resolveLoop(loop, maxFrame);
  const loopReadout = formatLoopReadout(loop, fps, maxFrame, t);
  const clearable = hasLoop(loop);

  // A boundary on the track's edge must keep a visible, draggable footprint:
  // a zero-width band at the right edge is clipped away entirely (#245).
  const MIN_BAND_PCT = 0.5;
  const bandWidthPct = loopPoints
    ? Math.max(bandPct(loopPoints.out) - bandPct(loopPoints.in), MIN_BAND_PCT)
    : 0;
  const bandLeftPct = loopPoints ? Math.min(bandPct(loopPoints.in), 100 - bandWidthPct) : 0;

  // The band's end handles are pointer-only by design: they are a drag
  // enhancement of the I/O keys and the in/out-point buttons, which stay the
  // keyboard path (documented in docs/user/keyboard-shortcuts.md).
  const startDrag = (which: 'in' | 'out'): void => {
    dragCleanupRef.current?.();
    const track = trackRef.current;
    if (!track || disabled) return;
    const move = (ev: PointerEvent): void => {
      const frame = frameAtPointer(ev.clientX, track.getBoundingClientRect(), maxFrameRef.current);
      // Forward the raw pointer frame so setLoopFrame clamps against live loop state.
      setLoopFrameRef.current?.(which, frame);
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      if (dragCleanupRef.current === stop) dragCleanupRef.current = null;
    };
    dragCleanupRef.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <section className="timeline" aria-labelledby={headingId}>
      <div className="timeline-header">
        <div className="timeline-heading">
          <h2 id={headingId} className="preview-title">
            {t('timelinePanel.timeline')}
          </h2>
        </div>
        <div className="timeline-actions">
          <span className="readout loop-readout" aria-live="polite" aria-atomic="true">
            {loopReadout}
          </span>
          <div className="segmented" role="group" aria-label={t('timelinePanel.inAndOutPoints')}>
            <button
              type="button"
              className="segment segment-icon"
              aria-label={t('timelinePanel.setInPoint')}
              title={t('timelinePanel.setInPointI')}
              disabled={disabled}
              onClick={() => dispatch?.({ type: 'setLoopIn' })}
            >
              <ArrowRightFromLine size={16} />
            </button>
            <button
              type="button"
              className="segment segment-icon"
              aria-label={t('timelinePanel.setOutPoint')}
              title={t('timelinePanel.setOutPointO')}
              disabled={disabled}
              onClick={() => dispatch?.({ type: 'setLoopOut' })}
            >
              <ArrowLeftFromLine size={16} />
            </button>
            <button
              type="button"
              className="segment segment-icon"
              aria-label={t('timelinePanel.clearInAndOutPoints')}
              title={clearable ? t('timelinePanel.clearHint') : t('timelinePanel.clearUnavailable')}
              disabled={disabled || !clearable}
              onClick={() => dispatch?.({ type: 'clearLoop' })}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
      <div className="ruler">
        {timelineTicks(durationSec).map((tick) => {
          const pct = bandPct(Math.round(tick * fps));
          return (
            <span
              key={tick}
              className="ruler-tick"
              style={{
                left: `${Math.min(100, pct)}%`,
                transform:
                  pct <= 0 ? 'none' : pct >= 100 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {formatTime(tick)}
            </span>
          );
        })}
      </div>
      <div className="track" ref={trackRef}>
        {disabled ? null : <Filmstrip src={src} frames={frames} fps={fps} />}
        {loopPoints ? (
          <div
            className="loop-band"
            style={{
              left: `${bandLeftPct}%`,
              width: `${bandWidthPct}%`,
            }}
          >
            {/* A handle marks only a set boundary; a lone point's open end is the track edge. */}
            {loop.in !== null ? (
              <span
                className="loop-handle loop-handle-in"
                title={t('timelinePanel.inPointI')}
                onPointerDown={() => startDrag('in')}
              />
            ) : null}
            {loop.out !== null ? (
              <span
                className="loop-handle loop-handle-out"
                title={t('timelinePanel.outPointO')}
                onPointerDown={() => startDrag('out')}
              />
            ) : null}
          </div>
        ) : null}
        <div className="playhead" ref={playheadRef} />
        <input
          ref={scrubRef}
          type="range"
          aria-label={t('timelinePanel.playbackPosition')}
          min={0}
          max={maxFrame}
          step={1}
          defaultValue={0}
          disabled={disabled}
          onChange={(e) => {
            const frame = Number(e.currentTarget.value);
            // Keyboard scrubbing announces the time, not the raw frame index.
            e.currentTarget.setAttribute('aria-valuetext', formatTimeReadout(frame, fps, durationSec));
            scrubTo?.(frame);
          }}
        />
      </div>
    </section>
  );
}
