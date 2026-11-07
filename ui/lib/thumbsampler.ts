// DOM-side filmstrip sampling: draws frames from a hidden secondary video
// element into a small canvas and hands back object URLs. It never touches
// the playback element and seeks one frame at a time, so the count of seeks
// is what costs — bounded by the track width through thumbPlan, never by the
// recording's duration.

export interface ThumbSampler {
  /** One thumbnail for the frame index, or null when it cannot be drawn. */
  grab(frameIndex: number): Promise<string | null>;
  /** Drops the hidden elements; in-flight grabs settle to null. */
  dispose(): void;
}

export const THUMB_WIDTH = 135;
export const THUMB_HEIGHT = 76;

/** How long a seek may stall before the grab gives up on it. */
const SEEK_TIMEOUT_MS = 3000;

/**
 * The default sampler over the given document. The `doc` seam keeps the
 * media plumbing testable with fakes away from a real decoder.
 */
export function createThumbSampler(src: string, fps: number, doc: Document = document): ThumbSampler {
  const video = doc.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = src;
  const canvas = doc.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext('2d');
  let disposed = false;
  const pending = new Set<() => void>();

  const ready = new Promise<void>((resolve) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => resolve(), { once: true });
  });

  // A seek can also die mid-flight (media error, emptied source), so every
  // way out settles the grab — with success only for a confirmed position:
  // a real 'seeked', or the element already sitting within half a frame of
  // the target, because Chromium skips such no-op seeks and never fires
  // 'seeked'. The timeout bounds a seek whose events go missing, so one
  // grab can never stall the sequential fill. dispose() settles the waits
  // directly because aborting a seek fires no event the sampler can rely
  // on.
  function seekTo(time: number): Promise<boolean> {
    if (Math.abs(video.currentTime - time) < 0.5 / fps) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), SEEK_TIMEOUT_MS);
      const onSeeked = (): void => finish(true);
      const onFail = (): void => finish(false);
      const abort = (): void => finish(false);
      pending.add(abort);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onFail);
      video.addEventListener('emptied', onFail);
      video.currentTime = time;

      function finish(seeked: boolean): void {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onFail);
        video.removeEventListener('emptied', onFail);
        pending.delete(abort);
        resolve(seeked);
      }
    });
  }

  return {
    async grab(frameIndex: number): Promise<string | null> {
      await ready;
      if (disposed || ctx === null || !(fps > 0) || video.readyState < 2) return null;
      const seeked = await seekTo((frameIndex + 0.5) / fps);
      if (!seeked || disposed) return null;
      ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      return new Promise<string | null>((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob === null || disposed ? null : URL.createObjectURL(blob));
        }, 'image/jpeg', 0.7);
      });
    },
    dispose() {
      disposed = true;
      for (const abort of [...pending]) abort();
      video.removeAttribute('src');
    },
  };
}
