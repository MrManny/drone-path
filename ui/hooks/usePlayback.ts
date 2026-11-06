'use client';

// Playback wiring: the frame driver's lifecycle, the imperative scrubber,
// playhead and time-text updates (they change every presented frame and must
// not re-render the tree), and the transport controls. The pure frame math
// stays in frametime.ts and loop.ts.

import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PageVideo } from '../../src/appsession.js';
import type { Scene } from '../../src/renderer/scene.js';
import { createFrameDriver } from '../lib/framedriver.js';
import { clampFrame, formatTime, formatTimeReadout, timeAt } from '../lib/frametime.js';
import type { LoopState } from '../lib/loop.js';
import { engagedLoop } from '../lib/loop.js';

const NO_LOOP: LoopState = { in: null, out: null };

export interface Playback {
  ready: boolean;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  speed: 1 | 2 | 3 | 4;
  setSpeed: (rate: 1 | 2 | 3 | 4) => void;
  loop: LoopState;
  setLoopPoint: (which: 'in' | 'out') => void;
  /** Sets a loop point to an explicit frame, e.g. from a dragged handle. */
  setLoopFrame: (which: 'in' | 'out', frame: number) => void;
  clearLoop: () => void;
  scrubTo: (i: number) => void;
  stepBy: (deltaFrames: number) => void;
  togglePlay: () => void;
  handleScene: (scene: Scene) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  scrubRef: RefObject<HTMLInputElement | null>;
  /** The transport's "position / duration" readout. */
  timeRef: RefObject<HTMLSpanElement | null>;
  /** The map card's "Current position" readout, same text as timeRef. */
  positionRef: RefObject<HTMLSpanElement | null>;
  /** The preview strip's position word ("0:10"), inside its state tag. */
  statusTimeRef: RefObject<HTMLSpanElement | null>;
  /** The timeline playhead marker, moved imperatively like the scrubber. */
  playheadRef: RefObject<HTMLDivElement | null>;
}

export function usePlayback(video: PageVideo, durationSec: number): Playback {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const positionRef = useRef<HTMLSpanElement>(null);
  const statusTimeRef = useRef<HTMLSpanElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  // The head frame: committed or queued, so rapid steps never stack onto a
  // stale index before the driver's next tick.
  const latestIndexRef = useRef(0);
  const driverRef = useRef<ReturnType<typeof createFrameDriver> | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 3 | 4>(1);
  const [loop, setLoop] = useState<LoopState>(NO_LOOP);

  const handleScene = useCallback((scene: Scene) => {
    sceneRef.current = scene;
    // The driver may have committed frames before the scene existed; the
    // scene must show the current one, not its initial frame.
    void scene.setFrame(latestIndexRef.current);
    // Play is ready at the gate switch, not at the tile layer's load: the
    // gate warmed what the first frame shows.
    setReady(true);
  }, []);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const driver = createFrameDriver({
      video: videoEl,
      meta: video,
      applyFrame: (i) => {
        void sceneRef.current?.setFrame(i);
      },
      onIndex: (i) => {
        latestIndexRef.current = i;
        if (scrubRef.current) scrubRef.current.value = String(i);
        // Imperative like the scrubber: the readouts and the playhead change
        // every presented frame and must not re-render the tree at playback
        // rate.
        const readout = formatTimeReadout(i, video.fps, durationSec);
        if (timeRef.current) timeRef.current.textContent = readout;
        if (positionRef.current) positionRef.current.textContent = readout;
        if (statusTimeRef.current) {
          statusTimeRef.current.textContent = formatTime(timeAt(i, video.fps));
        }
        if (playheadRef.current) {
          const pct = video.frames > 1 ? (i / (video.frames - 1)) * 100 : 0;
          playheadRef.current.style.left = `${pct}%`;
        }
      },
    });
    driverRef.current = driver;
    driver.start();
    return () => {
      driver.stop();
      driverRef.current = null;
    };
  }, [video, durationSec]);

  // The loop state lives here; the driver owns the wrap mechanics.
  useEffect(() => {
    driverRef.current?.setLoop(loop);
  }, [video, loop]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl) videoEl.playbackRate = speed;
  }, [speed, video]);

  const scrubTo = useCallback(
    (i: number) => {
      const clamped = clampFrame(i, video.frames);
      latestIndexRef.current = clamped;
      driverRef.current?.scrub(clamped);
    },
    [video.frames],
  );

  const togglePlay = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !ready) return;
    if (videoEl.paused) {
      // play() on ended media restarts from the file start; a loop must
      // resume at its own start.
      const active = engagedLoop(loop);
      if (videoEl.ended && active) scrubTo(active.in);
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
  }, [ready, loop, scrubTo]);

  const stepBy = useCallback(
    (deltaFrames: number) => {
      const videoEl = videoRef.current;
      // Stepping is for close inspection: it parks playback first.
      if (videoEl && !videoEl.paused) videoEl.pause();
      scrubTo(latestIndexRef.current + deltaFrames);
    },
    [scrubTo],
  );

  const setLoopPoint = useCallback((which: 'in' | 'out') => {
    setLoop((prev) => ({ ...prev, [which]: latestIndexRef.current }));
  }, []);

  const setLoopFrame = useCallback(
    (which: 'in' | 'out', frame: number) => {
      setLoop((prev) => ({ ...prev, [which]: clampFrame(frame, video.frames) }));
    },
    [video.frames],
  );

  const clearLoop = useCallback(() => setLoop(NO_LOOP), []);

  return {
    ready,
    playing,
    setPlaying,
    speed,
    setSpeed,
    loop,
    setLoopPoint,
    setLoopFrame,
    clearLoop,
    scrubTo,
    stepBy,
    togglePlay,
    handleScene,
    videoRef,
    scrubRef,
    timeRef,
    positionRef,
    statusTimeRef,
    playheadRef,
  };
}
