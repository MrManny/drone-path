// DOM-side filmstrip sampling: draws the centered square crop of each frame
// from a hidden secondary video element into a small canvas and hands back
// object URLs. It never touches
// the playback element and seeks one frame at a time, so the count of seeks
// is what costs — bounded by the track width through thumbPlan, never by the
// recording's duration.

export interface ThumbSampler {
  /** One thumbnail for the frame index, or null when it cannot be drawn. */
  grab(frameIndex: number): Promise<string | null>;
  /** Drops the hidden elements; in-flight grabs settle to null. */
  dispose(): void;
}

export const THUMB_WIDTH = 76;
export const THUMB_HEIGHT = THUMB_WIDTH;

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
  // One seek at a time: overlapping seeks cancel each other and one
  // 'seeked' would fan out to both grabs.
  let queue: Promise<unknown> = Promise.resolve();

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
  // the element already sitting within half a frame of the target between
  // seeks, or a 'seeked' that actually lands there. Chromium skips a seek
  // to the position the element already holds and never fires 'seeked', and
  // a superseded seek's 'seeked' lands elsewhere — waiting for either would
  // either hang or draw the wrong frame. The timeout bounds a seek whose
  // events go missing, so one grab can never stall the sequential fill.
  // dispose() settles the waits directly because aborting a seek fires no
  // event the sampler can rely on.
  function seekTo(time: number): Promise<boolean> {
    if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.5 / fps) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), SEEK_TIMEOUT_MS);
      const onSeeked = (): void => {
        if (Math.abs(video.currentTime - time) < 0.5 / fps) finish(true);
      };
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

  async function grabFrame(frameIndex: number): Promise<string | null> {
    await ready;
    // Center-cropping needs the frame's coded size; media without one has
    // no square to draw.
    const side = Math.min(video.videoWidth, video.videoHeight);
    if (disposed || ctx === null || !(fps > 0) || video.readyState < 2 || !(side > 0)) return null;
    const seeked = await seekTo((frameIndex + 0.5) / fps);
    if (!seeked || disposed) return null;
    // A canvas tainted by the media throws SecurityError mid-grab; such
    // frames are simply not drawable.
    try {
      ctx.drawImage(
        video,
        (video.videoWidth - side) / 2,
        (video.videoHeight - side) / 2,
        side,
        side,
        0,
        0,
        THUMB_WIDTH,
        THUMB_HEIGHT,
      );
      return await new Promise<string | null>((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob === null || disposed ? null : URL.createObjectURL(blob));
        }, 'image/jpeg', 0.7);
      });
    } catch {
      return null;
    }
  }

  return {
    grab(frameIndex: number): Promise<string | null> {
      const grabbed = queue.then(() => grabFrame(frameIndex));
      queue = grabbed.catch(() => undefined);
      return grabbed;
    },
    dispose() {
      disposed = true;
      for (const abort of [...pending]) abort();
      video.removeAttribute('src');
    },
  };
}
