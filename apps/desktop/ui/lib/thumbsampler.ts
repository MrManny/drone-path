export interface ThumbSampler {
  grab(frameIndex: number): Promise<string | null>;
  dispose(): void;
}

export const THUMB_SIZE = 76;

const SEEK_TIMEOUT_MS = 3000;

export function createThumbSampler(src: string, fps: number, doc: Document = document): ThumbSampler {
  const video = doc.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = src;
  const canvas = doc.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const ctx = canvas.getContext('2d');
  let disposed = false;
  const pending = new Set<() => void>();
  let queue: Promise<unknown> = Promise.resolve();

  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => resolve(), { once: true });
  });

  // Chromium never fires 'seeked' when seeking to the position the element
  // already holds, and a superseded seek's 'seeked' lands elsewhere; the
  // timeout bounds a seek whose events go missing so the fill never stalls.
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
    let side = Math.min(video.videoWidth, video.videoHeight);
    if (disposed || ctx === null || !(fps > 0) || video.readyState < 2 || !(side > 0)) return null;
    const seeked = await seekTo((frameIndex + 0.5) / fps);
    if (!seeked || disposed) return null;
    side = Math.min(video.videoWidth, video.videoHeight);
    if (!(side > 0)) return null;
    try {
      ctx.drawImage(
        video,
        (video.videoWidth - side) / 2,
        (video.videoHeight - side) / 2,
        side,
        side,
        0,
        0,
        THUMB_SIZE,
        THUMB_SIZE,
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
      resolveReady();
      for (const abort of [...pending]) abort();
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
