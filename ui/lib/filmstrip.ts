// Filmstrip thumbnail planning and caching, pure and DOM-free: the plan
// bounds the thumbnail count by track width (never by duration, so an hour
// of footage costs the same as a minute), and the cache fills one thumb at a
// time through an injected grabber so tests can run it offline with fakes.

export interface ThumbPlan {
  /** How many thumbnails the track shows at its current width. */
  count: number;
  /** The sampled frame indices, ascending. */
  frames: number[];
}

/** One thumbnail per THUMB_STRIDE px of track, bounded to a fixed range. */
export const THUMB_STRIDE = 64;
export const MIN_THUMBS = 8;
export const MAX_THUMBS = 48;

/**
 * The thumbnail plan for a track of the given width: evenly spaced frame
 * indices across the recording. Width drives the count; the recording's
 * length only decides which frames are sampled.
 */
export function thumbPlan(trackWidth: number, frames: number): ThumbPlan {
  if (frames <= 0 || trackWidth <= 0) return { count: 0, frames: [] };
  const count = clamp(Math.floor(trackWidth / THUMB_STRIDE), MIN_THUMBS, MAX_THUMBS);
  if (frames === 1) return { count: 1, frames: [0] };
  const picked = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    picked.add(Math.round((i * (frames - 1)) / (count - 1)));
  }
  return { count, frames: [...picked].sort((a, b) => a - b) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** How the cache obtains one thumbnail; the DOM sampler implements this. */
export type GrabFrame = (frameIndex: number) => Promise<string | null>;
/** How a produced thumbnail is released; object URLs need revoking. */
export type ReleaseThumb = (url: string) => void;

export interface FilmstripCacheOptions {
  grab: GrabFrame;
  release?: ReleaseThumb;
}

/**
 * A sequential, cancellable thumbnail cache. `load` fills the missing
 * frames one at a time in order and reports each arrival through `onThumb`;
 * a newer `load` cancels the previous run, and `dispose` releases every
 * cached thumbnail. Nothing here touches the playback video element.
 */
export class FilmstripCache {
  readonly #grab: GrabFrame;
  readonly #release: ReleaseThumb;
  readonly #thumbs = new Map<number, string>();
  #generation = 0;

  constructor(options: FilmstripCacheOptions) {
    this.#grab = options.grab;
    this.#release = options.release ?? (() => {});
  }

  get size(): number {
    return this.#thumbs.size;
  }

  /**
   * Fills the missing frames of the plan in order. Returns the generation
   * token of this run; arrivals from older runs are ignored.
   */
  load(frames: readonly number[], onThumb: (frame: number, url: string) => void): number {
    this.#generation += 1;
    const generation = this.#generation;
    const pending = frames.filter((frame) => !this.#thumbs.has(frame));
    void (async () => {
      for (const frame of pending) {
        if (generation !== this.#generation) return;
        const url = await this.#grab(frame);
        if (generation !== this.#generation) {
          if (url !== null) this.#release(url);
          return;
        }
        if (url === null) continue;
        this.#thumbs.set(frame, url);
        onThumb(frame, url);
      }
    })();
    return generation;
  }

  /** Cancels any run in flight; cached thumbs stay. */
  cancel(): void {
    this.#generation += 1;
  }

  /** Drops every cached thumbnail, releasing each one. */
  dispose(): void {
    this.cancel();
    for (const url of this.#thumbs.values()) this.#release(url);
    this.#thumbs.clear();
  }
}
