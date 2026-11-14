import type { PageVideo } from '../../src/appsession.js';
import { clampFrame, frameFromMediaTime } from './frametime.js';
import type { LoopPoints, LoopState } from './loop.js';
import { resolveLoop } from './loop.js';

interface FrameDriverOpts {
  video: HTMLVideoElement;
  meta: PageVideo;
  applyFrame: (i: number) => void;
  onIndex: (i: number) => void;
}

interface FrameDriver {
  scrub(i: number): void;
  setLoop(state: LoopState | null): void;
  start(): void;
  stop(): void;
}

export function createFrameDriver(opts: FrameDriverOpts): FrameDriver {
  const { video, meta } = opts;
  const { fps, frames } = meta;
  let shownIdx = -1;
  let pendingScrub: number | null = null;
  let loop: LoopState | null = null;
  let running = false;
  let rafId = 0;
  let presentedId = 0;

  function commit(i: number): void {
    if (i === shownIdx) return;
    shownIdx = i;
    opts.applyFrame(i);
    opts.onIndex(i);
  }

  function activeLoop(): LoopPoints | null {
    return loop === null ? null : resolveLoop(loop, frames - 1);
  }

  // Explicit seeks land half a frame into frame i's span: an exact i / fps can
  // fall under frame i's PTS and settle the previous frame (#92).
  function seekToFrame(i: number): void {
    video.currentTime = (i + 0.5) / fps;
  }

  function wrapTo(active: LoopPoints): void {
    seekToFrame(active.in);
    commit(active.in);
  }

  function commitPlayed(i: number): void {
    const active = activeLoop();
    if (active !== null && i > active.out && !video.paused && !video.ended) {
      wrapTo(active);
      return;
    }
    commit(i);
  }

  // The presented frame's mediaTime maps to the frame index via floor: round
  // would make the map lead the footage by half a frame.
  function onPresentedFrame(_now: number, meta_: { mediaTime: number }): void {
    if (!running) return;
    commitPlayed(frameFromMediaTime(meta_.mediaTime, fps, frames));
    presentedId = video.requestVideoFrameCallback(onPresentedFrame);
  }
  const usePresented = typeof video.requestVideoFrameCallback === 'function';

  function tick(_now: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    const active = activeLoop();
    if (pendingScrub !== null) {
      const seekTo = pendingScrub;
      pendingScrub = null;
      seekToFrame(seekTo);
      commit(seekTo);
    } else if (active !== null && video.ended) {
      wrapTo(active);
      video.play().catch(() => {});
    } else if (!usePresented && !video.paused && !video.ended) {
      commitPlayed(frameFromMediaTime(video.currentTime, fps, frames));
    }
  }

  return {
    scrub(i: number): void {
      pendingScrub = clampFrame(i, frames);
    },
    setLoop(state: LoopState | null): void {
      loop = state;
    },
    start(): void {
      if (running) return;
      running = true;
      if (usePresented && presentedId === 0) {
        presentedId = video.requestVideoFrameCallback(onPresentedFrame);
      }
      rafId = requestAnimationFrame(tick);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
      if (usePresented && presentedId !== 0) {
        video.cancelVideoFrameCallback(presentedId);
        presentedId = 0;
      }
    },
  };
}
