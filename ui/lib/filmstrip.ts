interface ThumbPlan {
  count: number;
  frames: number[];
}

const THUMB_STRIDE = 64;
export const TARGET_THUMBS = 12;

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

type GrabFrame = (frameIndex: number) => Promise<string | null>;
type ReleaseThumb = (url: string) => void;

interface FilmstripCacheOptions {
  grab: GrabFrame;
  release?: ReleaseThumb;
}

interface FillRun {
  readonly frames: readonly number[];
  readonly listeners: Set<(frame: number, url: string) => void>;
  readonly pending: Set<number>;
}

const NO_FRAMES: ReadonlySet<number> = new Set();

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

  load(frames: readonly number[], onThumb: (frame: number, url: string) => void): void {
    const run = this.#run;
    const missing = frames.filter((frame) => !this.#thumbs.has(frame));
    if (
      run !== null &&
      sameFrames(run.frames, frames) &&
      missing.every((frame) => run.pending.has(frame))
    ) {
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

  cancel(): void {
    this.#run = null;
  }

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
