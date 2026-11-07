// Filmstrip thumbnail planning and caching, pure and DOM-free: the plan
// spreads one fixed budget of stills across the whole recording — cost
// follows the track width only, never the duration — and the cache fills
// one thumb at a time through an injected grabber so tests can run it
// offline with fakes.

export interface ThumbPlan {
  /** How many thumbnails the track shows at its current width. */
  count: number;
  /** The sampled frame indices, ascending. */
  frames: number[];
}

const THUMB_STRIDE = 64;
/** The stills a full strip aims for; only the track width lowers this. */
export const TARGET_THUMBS = 12;

/**
 * The thumbnail plan for a track of the given width: stills equidistant
 * along the entire recording, from the first frame to the last. Track width
 * only caps how many stills fit; the duration never changes the cost.
 */
export function thumbPlan(trackWidth: number, frames: number): ThumbPlan {
  if (frames <= 0 || trackWidth <= 0) return { count: 0, frames: [] };
  const count = Math.min(TARGET_THUMBS, Math.floor(trackWidth / THUMB_STRIDE), frames);
  if (count === 0) return { count: 0, frames: [] };
  if (count === 1) return { count: 1, frames: [0] };
  const picked: number[] = [];
  for (let i = 0; i < count; i += 1) {
    picked.push(Math.round((i * (frames - 1)) / (count - 1)));
  }
  return { count, frames: picked };
}

export function sameFrames(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((frame, index) => frame === b[index]);
}

/** How the cache obtains one thumbnail; the DOM sampler implements this. */
export type GrabFrame = (frameIndex: number) => Promise<string | null>;
/** How a produced thumbnail is released; object URLs need revoking. */
export type ReleaseThumb = (url: string) => void;

export interface FilmstripCacheOptions {
  grab: GrabFrame;
  release?: ReleaseThumb;
}

interface FillRun {
  readonly frames: readonly number[];
  readonly listeners: Set<(frame: number, url: string) => void>;
  readonly pending: Set<number>;
}

const NO_FRAMES: ReadonlySet<number> = new Set();

/**
 * A sequential, cancelable thumbnail cache. `load` fills the missing frames
 * of a plan one at a time and reports every requested frame through
 * `onThumb` exactly once — thumbs already cached are replayed immediately,
 * the rest as they land. Loading the same plan again joins the run in
 * flight instead of restarting it; a different plan supersedes it.
 * Completed grabs stay cached even from superseded runs — only `dispose`
 * throws them away. Nothing here touches the playback video element.
 */
export class FilmstripCache {
  readonly #grab: GrabFrame;
  readonly #release: ReleaseThumb;
  readonly #thumbs = new Map<number, string>();
  readonly #inFlight = new Map<number, Promise<string | null>>();
  #run: FillRun | null = null;
  #disposed = false;

  constructor(options: FilmstripCacheOptions) {
    this.#grab = options.grab;
    this.#release = options.release ?? (() => {});
  }

  get size(): number {
    return this.#thumbs.size;
  }

  /** Fills the missing frames of the plan in order, reporting each one. */
  load(frames: readonly number[], onThumb: (frame: number, url: string) => void): void {
    const run = this.#run;
    const missing = frames.filter((frame) => !this.#thumbs.has(frame));
    if (
      run !== null &&
      sameFrames(run.frames, frames) &&
      missing.every((frame) => run.pending.has(frame))
    ) {
      // The joined run reports the frames it still owes; replay only the rest.
      this.#replay(frames, onThumb, run.pending);
      run.listeners.add(onThumb);
      return;
    }
    this.#replay(frames, onThumb, NO_FRAMES);
    if (missing.length === 0) return;
    const active: FillRun = {
      frames,
      listeners: new Set([onThumb]),
      pending: new Set(missing),
    };
    this.#run = active;
    void (async () => {
      for (const frame of [...active.pending]) {
        if (this.#run !== active) return;
        await this.#fill(active, frame);
      }
      if (this.#run === active) this.#run = null;
    })();
  }

  /** Cancels any run in flight; cached thumbs stay. */
  cancel(): void {
    this.#run = null;
  }

  /** Drops every cached thumbnail, releasing each one. */
  dispose(): void {
    this.cancel();
    this.#disposed = true;
    for (const url of this.#thumbs.values()) this.#release(url);
    this.#thumbs.clear();
  }

  #replay(
    frames: readonly number[],
    onThumb: (frame: number, url: string) => void,
    owed: ReadonlySet<number>,
  ): void {
    for (const frame of new Set(frames)) {
      const url = this.#thumbs.get(frame);
      if (url !== undefined && !owed.has(frame)) onThumb(frame, url);
    }
  }

  async #fill(run: FillRun, frame: number): Promise<void> {
    const url = this.#thumbs.get(frame) ?? (await this.#grabOne(frame));
    run.pending.delete(frame);
    if (url === null || this.#run !== run) return;
    for (const onThumb of run.listeners) onThumb(frame, url);
  }

  // A grab in flight is shared: reloading the plan awaits the same promise
  // instead of seeking twice. Its result lands in the cache whoever asked
  // for it, so a superseded run never throws finished work away, and a
  // failed grab stays missing for the next load to retry.
  #grabOne(frame: number): Promise<string | null> {
    const inFlight = this.#inFlight.get(frame);
    if (inFlight !== undefined) return inFlight;
    const grab = this.#grab(frame)
      .catch(() => null)
      .then((url) => {
        this.#inFlight.delete(frame);
        if (url === null) return null;
        if (this.#disposed) {
          this.#release(url);
          return null;
        }
        this.#thumbs.set(frame, url);
        return url;
      });
    this.#inFlight.set(frame, grab);
    return grab;
  }
}
