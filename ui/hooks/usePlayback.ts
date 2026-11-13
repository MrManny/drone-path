'use client';

import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PageVideo } from '../../src/appsession.js';
import type { Scene } from '../../src/renderer/scene.js';
import { createFrameDriver } from '../lib/framedriver.js';
import { clampFrame, formatTimeReadout } from '../lib/frametime.js';
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
  setLoopFrame: (which: 'in' | 'out', frame: number) => void;
  clearLoop: () => void;
  scrubTo: (i: number) => void;
  stepBy: (deltaFrames: number) => void;
  togglePlay: () => void;
  handleScene: (scene: Scene) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  scrubRef: RefObject<HTMLInputElement | null>;
  timeRef: RefObject<HTMLSpanElement | null>;
  playheadRef: RefObject<HTMLDivElement | null>;
}

export function usePlayback(video: PageVideo, durationSec: number): Playback {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const latestIndexRef = useRef(0);
  const driverRef = useRef<ReturnType<typeof createFrameDriver> | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 3 | 4>(1);
  const [loop, setLoop] = useState<LoopState>(NO_LOOP);

  const handleScene = useCallback((scene: Scene) => {
    sceneRef.current = scene;
    void scene.setFrame(latestIndexRef.current);
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
        const readout = formatTimeReadout(i, video.fps, durationSec);
        if (scrubRef.current) {
          scrubRef.current.value = String(i);
          // The slider announces its position as a time, not a frame index.
          scrubRef.current.setAttribute('aria-valuetext', readout);
        }
        if (timeRef.current) timeRef.current.textContent = readout;
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
    playheadRef,
  };
}
