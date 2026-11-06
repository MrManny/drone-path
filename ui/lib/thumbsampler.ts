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

  const ready = new Promise<void>((resolve) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => resolve(), { once: true });
  });

  return {
    async grab(frameIndex: number): Promise<string | null> {
      await ready;
      if (disposed || ctx === null || !(fps > 0) || video.readyState < 2) return null;
      await new Promise<void>((resolve) => {
        const done = (): void => {
          video.removeEventListener('seeked', done);
          resolve();
        };
        video.addEventListener('seeked', done);
        video.currentTime = (frameIndex + 0.5) / fps;
      });
      if (disposed) return null;
      ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      return new Promise<string | null>((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob === null || disposed ? null : URL.createObjectURL(blob));
        }, 'image/jpeg', 0.7);
      });
    },
    dispose() {
      disposed = true;
      video.removeAttribute('src');
    },
  };
}
