'use client';

import { useRef } from 'react';
import type { RefObject } from 'react';

import { formatLoopReadout, formatTime, timelineTicks } from '../lib/frametime.js';
import type { HotkeyAction } from '../lib/hotkeys.js';
import type { LoopState } from '../lib/loop.js';
import { clampHandleFrame, engagedLoop, hasLoop } from '../lib/loop.js';
import { CloseIcon } from '../icons/CloseIcon.js';
import { MarkInIcon } from '../icons/MarkInIcon.js';
import { MarkOutIcon } from '../icons/MarkOutIcon.js';
import { PlayIcon } from '../icons/PlayIcon.js';
import { Filmstrip } from './Filmstrip.js';

export interface TimelinePanelProps {
  /** The player's action map: buttons and hotkeys drive the same actions. */
  dispatch: (action: HotkeyAction) => void;
  loop: LoopState;
  setLoopFrame: (which: 'in' | 'out', frame: number) => void;
  /** Raw timeline values; the panel formats its own readouts from them. */
  fps: number;
  frames: number;
  durationSec: number;
  maxFrame: number;
  scrubTo: (i: number) => void;
  scrubRef: RefObject<HTMLInputElement | null>;
  /** The playhead marker, moved imperatively by the frame driver. */
  playheadRef: RefObject<HTMLDivElement | null>;
  /** The video's media URL, sampled for the filmstrip thumbnails. */
  src: string;
}

// The timeline panel: loop actions and readout in the header, a time ruler,
// and the video track — filmstrip thumbnails, the loop band with draggable
// ends, the playhead, and the native range slider over it all (the slider is
// the keyboard-accessible scrub control; its thumb is the playhead).
export function TimelinePanel({
  dispatch,
  loop,
  setLoopFrame,
  fps,
  frames,
  durationSec,
  maxFrame,
  scrubTo,
  scrubRef,
  playheadRef,
  src,
}: TimelinePanelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const bandPct = (i: number): number => (maxFrame > 0 ? (i / maxFrame) * 100 : 0);
  const loopPoints = engagedLoop(loop);
  const loopReadout = formatLoopReadout(loop, fps);
  const clearable = hasLoop(loop);

  const dragHandle = (which: 'in' | 'out') =>
    (): void => {
      const track = trackRef.current;
      if (!track) return;
      const move = (ev: PointerEvent): void => {
        const rect = track.getBoundingClientRect();
        const ratio = rect.width > 0 ? (ev.clientX - rect.left) / rect.width : 0;
        setLoopFrame(which, clampHandleFrame(which, Math.round(ratio * maxFrame), loop, maxFrame));
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

  return (
    <section className="timeline">
      <div className="timeline-header">
        <div className="timeline-heading">
          <span className="preview-title">Timeline</span>
          <span className="preview-note">Playback &amp; loop points</span>
        </div>
        <div className="timeline-actions">
          <button
            type="button"
            aria-label="Set loop in"
            title="Set loop in (I)"
            onClick={() => dispatch({ type: 'setLoopIn' })}
          >
            <MarkInIcon />
            Set in
          </button>
          <button
            type="button"
            aria-label="Set loop out"
            title="Set loop out (O)"
            onClick={() => dispatch({ type: 'setLoopOut' })}
          >
            <MarkOutIcon />
            Set out
          </button>
          <button
            type="button"
            aria-label="Clear loop"
            title={clearable ? 'Clear loop (Esc)' : 'No loop to clear.'}
            disabled={!clearable}
            onClick={() => dispatch({ type: 'clearLoop' })}
          >
            <CloseIcon />
            Clear
          </button>
          {loopReadout ? <span className="readout loop-readout">{loopReadout}</span> : null}
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
      <div className="track-row">
        <div className="track-label">
          <span className="track-chip">
            <PlayIcon />
          </span>
          <div className="track-names">
            <strong>Video</strong>
          </div>
        </div>
        <div className="track" ref={trackRef}>
          <Filmstrip src={src} frames={frames} fps={fps} />
          {loopPoints ? (
            <div
              className="loop-band"
              style={{
                left: `${bandPct(loopPoints.in)}%`,
                width: `${bandPct(loopPoints.out) - bandPct(loopPoints.in)}%`,
              }}
            >
              <span
                className="loop-handle loop-handle-in"
                title="Loop in (I)"
                onPointerDown={dragHandle('in')}
              />
              <span
                className="loop-handle loop-handle-out"
                title="Loop out (O)"
                onPointerDown={dragHandle('out')}
              />
            </div>
          ) : null}
          <div className="playhead" ref={playheadRef} />
          <input
            ref={scrubRef}
            type="range"
            aria-label="Playback position"
            min={0}
            max={maxFrame}
            step={1}
            defaultValue={0}
            onChange={(e) => scrubTo(Number(e.target.value))}
          />
        </div>
      </div>
    </section>
  );
}
