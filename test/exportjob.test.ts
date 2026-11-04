import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExportRequest } from '../src/config.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createExportRunner } from '../src/exportjob.js';
import type { ExportOutcome, RunExportJob } from '../src/exportjob.js';
import type { PipelineDeps, RecordingSummary } from '../src/run.js';
import { createTileTraffic } from '../src/tiles.js';
import type { PrefetchOptions, PrefetchStats } from '../src/tiles.js';
import { cleanupTmpDirs, stubDeps, tmpDir } from './fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanupTmpDirs();
});

const SOURCE = path.join(tmpDir(), 'flight.mp4');

function summaryFor(out: string): RecordingSummary {
  return { video: SOURCE, out, status: 'ok', elapsedSec: 1, frames: 3, fps: '30' };
}

function requestFor(outPath: string, range: ExportRequest['range'] = null): ExportRequest {
  return { outPath, config: { ...DEFAULT_CONFIG, tileCache: tmpDir() }, range };
}

// The render stub must leave the working file behind: the runner's swap is
// the very thing that turns a finished render into the destination.
const writesOutput: PipelineDeps['renderVideo'] = async ({ outPath }) => {
  fs.writeFileSync(outPath, 'rendered');
  return { profile: { evalMs: 1, captureMs: 2, emitMs: 3 } };
};

// Resolves when the runner reports; the job itself is driven by the test.
function harness(run: RunExportJob) {
  const outcomes: ExportOutcome[] = [];
  const runner = createExportRunner({ run, onDone: (o) => outcomes.push(o) });
  const settled = () =>
    new Promise<ExportOutcome>((resolve) => {
      const tick = () => (outcomes.length ? resolve(outcomes[0]) : setTimeout(tick, 2));
      tick();
    });
  return { runner, outcomes, settled };
}

describe('export runner: successful export', () => {
  it('renders to a working file, then renames it onto the destination', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    const seen: { working?: string } = {};
    const { runner, settled } = harness(async (_v, _r, _log, working) => {
      seen.working = working;
      fs.writeFileSync(working, 'rendered');
      return summaryFor(working);
    });

    runner.start(SOURCE, requestFor(out));
    const outcome = await settled();

    expect(seen.working).not.toBe(out);
    expect(path.dirname(seen.working as string)).toBe(dir);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.summary.out).toBe(out);
    expect(fs.readFileSync(out, 'utf8')).toBe('rendered');
    expect(fs.existsSync(seen.working as string)).toBe(false);
  });

  it('forwards the frozen range to the pipeline', async () => {
    const out = path.join(tmpDir(), 'seg.mp4');
    let received: ExportRequest | null = null;
    const { runner, settled } = harness(async (_v, request, _log, working) => {
      received = request;
      fs.writeFileSync(working, 'x');
      return summaryFor(working);
    });
    runner.start(SOURCE, requestFor(out, { start: 4, end: 9 }));
    await settled();
    expect(received).not.toBeNull();
    expect((received as unknown as ExportRequest).range).toEqual({ start: 4, end: 9 });
  });

  it('replaces a pre-existing destination only after the render succeeded', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    fs.writeFileSync(out, 'old export');
    const { runner, settled } = harness(async (_v, _r, _log, working) => {
      fs.writeFileSync(working, 'new export');
      return summaryFor(working);
    });
    runner.start(SOURCE, requestFor(out));
    expect((await settled()).status).toBe('ok');
    expect(fs.readFileSync(out, 'utf8')).toBe('new export');
  });
});

describe('export runner: failures never destroy the destination', () => {
  it('keeps a pre-existing file byte-identical when the render fails', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    fs.writeFileSync(out, 'precious original');
    const { runner, settled } = harness(async (_v, _r, _log, working) => {
      fs.writeFileSync(working, 'half-written');
      throw new Error('ffmpeg exited with code 1');
    });
    runner.start(SOURCE, requestFor(out));
    const outcome = await settled();
    expect(outcome).toEqual({ status: 'error', error: 'ffmpeg exited with code 1' });
    expect(fs.readFileSync(out, 'utf8')).toBe('precious original');
  });

  it('removes the working file after a failed render', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    let working = '';
    const { runner, settled } = harness(async (_v, _r, _log, w) => {
      working = w;
      fs.writeFileSync(w, 'partial');
      throw new Error('boom');
    });
    runner.start(SOURCE, requestFor(out));
    await settled();
    expect(fs.existsSync(working)).toBe(false);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('reports cancel as a canceled outcome and removes the working file', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    let working = '';
    const { runner, settled } = harness(async (_v, _r, _log, w, signal) => {
      working = w;
      fs.writeFileSync(w, 'partial');
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      throw new Error('render canceled');
    });
    runner.start(SOURCE, requestFor(out));
    runner.cancel();
    expect(await settled()).toEqual({ status: 'canceled' });
    expect(fs.existsSync(working)).toBe(false);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('keeps the finished render and reports an error when the final swap fails', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    let working = '';
    // A directory at the destination makes the rename fail on every platform.
    fs.mkdirSync(out);
    const { runner, settled } = harness(async (_v, _r, _log, w) => {
      working = w;
      fs.writeFileSync(w, 'finished');
      return summaryFor(w);
    });
    runner.start(SOURCE, requestFor(out));
    const outcome = await settled();
    expect(outcome.status).toBe('error');
    expect(fs.readFileSync(working, 'utf8')).toBe('finished');
  });
});

describe('export runner: guard rails', () => {
  it('rejects a second start while a job runs', async () => {
    const out = path.join(tmpDir(), 'a.mp4');
    const { runner, settled } = harness(async (_v, _r, _log, working, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      throw new Error('render canceled');
    });
    runner.start(SOURCE, requestFor(out));
    expect(() => runner.start(SOURCE, requestFor(path.join(tmpDir(), 'b.mp4')))).toThrow(
      'an export is already running',
    );
    runner.cancel();
    await settled();
  });

  it('accepts a new job once the previous one has settled', async () => {
    const out = path.join(tmpDir(), 'a.mp4');
    const outcomes: ExportOutcome[] = [];
    const runner = createExportRunner({
      run: async (_v, _r, _log, working) => {
        fs.writeFileSync(working, 'x');
        return summaryFor(working);
      },
      onDone: (o) => outcomes.push(o),
    });
    runner.start(SOURCE, requestFor(out));
    await new Promise((r) => setTimeout(r, 20));
    expect(runner.running()).toBe(false);
    expect(() => runner.start(SOURCE, requestFor(path.join(tmpDir(), 'b.mp4')))).not.toThrow();
  });

  it('refuses to overwrite the source recording', () => {
    const { runner } = harness(async () => summaryFor(SOURCE));
    expect(() => runner.start(SOURCE, requestFor(SOURCE))).toThrow(
      'must not overwrite the source recording',
    );
  });

  it('applies the platform case rule to the overwrite guard', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'Flight.mp4');
    const out = path.join(dir, 'flight.mp4');
    const { runner, settled } = harness(async (_v, _r, _log, _w, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      throw new Error('render canceled');
    });
    if (process.platform === 'win32') {
      expect(() => runner.start(video, requestFor(out))).toThrow(
        'must not overwrite the source recording',
      );
    } else {
      expect(() => runner.start(video, requestFor(out))).not.toThrow();
      runner.cancel();
      await settled();
    }
  });

  it('refuses a relative destination path', () => {
    const { runner } = harness(async () => summaryFor(''));
    expect(() => runner.start(SOURCE, requestFor('relative/out.mp4'))).toThrow(
      'output path must be absolute',
    );
  });

  it('never reuses a stray working file, picking the next free name', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    const stray = path.join(dir, 'flight_map.partial.mp4');
    fs.writeFileSync(stray, 'someone else');
    let working = '';
    const { runner, settled } = harness(async (_v, _r, _log, w) => {
      working = w;
      fs.writeFileSync(w, 'x');
      return summaryFor(w);
    });
    runner.start(SOURCE, requestFor(out));
    await settled();
    expect(working).toBe(path.join(dir, 'flight_map.partial-2.mp4'));
    expect(fs.readFileSync(stray, 'utf8')).toBe('someone else');
  });

  it('names the working file <stem>.partial.mp4 when nothing is taken', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    let working = '';
    const { runner, settled } = harness(async (_v, _r, _log, w) => {
      working = w;
      fs.writeFileSync(w, 'x');
      return summaryFor(w);
    });
    runner.start(SOURCE, requestFor(out));
    await settled();
    expect(working).toBe(path.join(dir, 'flight_map.partial.mp4'));
  });

  it('walks .partial-2, .partial-3 past stray working names', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    for (const name of ['flight_map.partial.mp4', 'flight_map.partial-2.mp4']) {
      fs.writeFileSync(path.join(dir, name), 'someone else');
    }
    let working = '';
    const { runner, settled } = harness(async (_v, _r, _log, w) => {
      working = w;
      fs.writeFileSync(w, 'x');
      return summaryFor(w);
    });
    runner.start(SOURCE, requestFor(out));
    await settled();
    expect(working).toBe(path.join(dir, 'flight_map.partial-3.mp4'));
  });

  it('never uses a .partial-1 name, strays or not', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    fs.writeFileSync(path.join(dir, 'flight_map.partial-1.mp4'), 'someone else');
    let working = '';
    const { runner, settled } = harness(async (_v, _r, _log, w) => {
      working = w;
      fs.writeFileSync(w, 'x');
      return summaryFor(w);
    });
    runner.start(SOURCE, requestFor(out));
    await settled();
    expect(working).toBe(path.join(dir, 'flight_map.partial.mp4'));
    expect(fs.existsSync(path.join(dir, 'flight_map.partial-1.mp4'))).toBe(true);
  });
});

describe('export runner: completion safety', () => {
  it('reports a throwing onDone instead of rejecting unhandled', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    const logs: string[] = [];
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      const runner = createExportRunner({
        log: (message) => logs.push(message),
        run: async (_v, _r, _log, working) => {
          fs.writeFileSync(working, 'x');
          return summaryFor(working);
        },
        onDone: () => {
          throw new Error('consumer blew up');
        },
      });
      runner.start(SOURCE, requestFor(out));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // The export itself still completed; only the callback blew up.
      expect(fs.readFileSync(out, 'utf8')).toBe('x');
      expect(logs.some((m) => m.includes('export completion failed'))).toBe(true);
      expect(logs.some((m) => m.includes('consumer blew up'))).toBe(true);
      expect(rejections).toEqual([]);
      expect(runner.running()).toBe(false);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});

describe('export runner: the default run honors injected deps', () => {
  it('warms the tiles through the injected prefetch', async () => {
    const cacheDir = tmpDir();
    const out = path.join(tmpDir(), 'flight_map.mp4');
    const prefetchTiles = vi.fn(
      async ({ tiles }: PrefetchOptions): Promise<PrefetchStats> => ({
        downloaded: tiles.length,
        failed: 0,
        total: tiles.length,
      }),
    );

    const outcome = await new Promise<ExportOutcome>((resolve) => {
      const runner = createExportRunner({
        deps: stubDeps({ prefetchTiles, renderVideo: writesOutput }),
        onDone: resolve,
      });
      runner.start(SOURCE, {
        outPath: out,
        config: { ...DEFAULT_CONFIG, tileCache: cacheDir },
        range: null,
      });
    });

    expect(outcome.status).toBe('ok');
    expect(prefetchTiles).toHaveBeenCalledTimes(1);
    const warm = prefetchTiles.mock.calls[0][0];
    expect(warm.cacheDir).toBe(cacheDir);
    expect(warm.tiles.length).toBeGreaterThan(0);
  });

  it('fails the export when the tile warm fails', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'flight_map.mp4');
    const prefetchTiles = vi.fn(async (): Promise<PrefetchStats> => {
      throw new Error('cache unwritable');
    });

    const outcome = await new Promise<ExportOutcome>((resolve) => {
      const runner = createExportRunner({
        deps: stubDeps({ prefetchTiles }),
        onDone: resolve,
      });
      runner.start(SOURCE, {
        outPath: out,
        config: { ...DEFAULT_CONFIG, tileCache: tmpDir() },
        range: null,
      });
    });

    expect(outcome).toEqual({ status: 'error', error: 'cache unwritable' });
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.readdirSync(dir).filter((name) => name.includes('.partial'))).toEqual([]);
  });

  it('keeps the export warm and the app warm inside one 500 ms budget', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const cacheDir = tmpDir();
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        return new Response(new Uint8Array([1]), { status: 200 });
      }),
    );
    // The app composition: the export's warm joins the app's tile queue.
    const traffic = createTileTraffic(cacheDir);
    const outcome = new Promise<ExportOutcome>((resolve) => {
      const runner = createExportRunner({
        deps: stubDeps({
          prefetchTiles: (options) => traffic.stream(options),
          renderVideo: writesOutput,
        }),
        onDone: resolve,
      });
      runner.start(SOURCE, {
        outPath: path.join(dir, 'flight_map.mp4'),
        config: { ...DEFAULT_CONFIG, tileCache: cacheDir },
        range: null,
      });
    });
    const warm = traffic.stream({
      style: 'satellite',
      tiles: [
        { z: 1, x: 0, y: 0 },
        { z: 1, x: 0, y: 1 },
      ],
    });
    await vi.advanceTimersByTimeAsync(600000);
    const [result] = await Promise.all([outcome, warm]);

    expect(result.status).toBe('ok');
    const downloaded = result.status === 'ok' ? (result.summary.tilesDownloaded ?? 0) : 0;
    expect(downloaded).toBeGreaterThan(0);
    expect(starts).toHaveLength(2 + downloaded);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });
});
