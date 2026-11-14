import fs from 'node:fs';
import path from 'node:path';
import type * as childProcessModule from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaptureSession, CaptureSessionSpec } from '../app/electron-session.mjs';
import { createElectronRenderVideo } from '../app/render-video.mjs';
import type { ExportRequest } from '../src/config.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ERR_RENDER_CANCELED } from '../src/errors.js';
import { createExportRunner } from '../src/exportjob.js';
import type { ExportOutcome } from '../src/exportjob.js';
import type { FfmpegToolPaths } from '../src/ffmpeg-tools.js';
import type { CaptureProgress, RenderJobOptions } from '../src/render.js';
import { cleanupTmpDirs, probeFixture, stubDeps, tmpDir } from './fixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const mocks = vi.hoisted(() => ({
  exitCode: 0,
  spawnCmds: [] as string[],
  spawnArgs: [] as string[][],
}));

// A deterministic stand-in for ffmpeg: the frames written to its stdin become
// the output file, so the test can assert capture order byte for byte.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcessModule>();
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const fsMod = await import('node:fs');
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      mocks.spawnCmds.push(cmd);
      mocks.spawnArgs.push(args);
      const outPath = args[args.length - 1];
      const proc = new EventEmitter() as InstanceType<typeof EventEmitter> & {
        stdin: InstanceType<typeof PassThrough>;
        stderr: InstanceType<typeof PassThrough>;
        kill: () => void;
      };
      proc.stdin = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = () => {};
      const sink = fsMod.createWriteStream(outPath);
      // A killed or failed render can leave the sink mid-open as the fixtures
      // clean up; sink errors are not what these tests assert on.
      sink.on('error', () => {});
      proc.stdin.pipe(sink);
      sink.on('finish', () => proc.emit('close', mocks.exitCode));
      return proc;
    },
  };
});

// The packaged condition: electron-builder.yml ships no playwright-core, so
// any use of it must fail exactly like the installed app's did. The throwing
// getter fails at first use (the CLI renderer's `chromium` access) without
// tripping vi.mock's factory-error wrapping.
vi.mock('playwright-core', () => ({
  get chromium(): never {
    const err = new Error("Cannot find package 'playwright-core' imported from dist/render.js");
    Object.assign(err, { code: 'ERR_MODULE_NOT_FOUND' });
    throw err;
  },
}));

// Never load the real Electron package (it would fetch its binary); the
// driver tests inject their capture sessions and never touch windows.
vi.mock('electron', () => ({ BrowserWindow: class {} }));

beforeEach(() => {
  mocks.exitCode = 0;
  mocks.spawnCmds = [];
  mocks.spawnArgs = [];
});

afterEach(cleanupTmpDirs);

const TOOLS: FfmpegToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };

function fakeSessions(
  hooks: { onSetFrame?: (frame: number) => void; captureError?: string } = {},
) {
  const state = {
    specs: [] as CaptureSessionSpec[],
    frames: [] as number[],
    closed: 0,
  };
  const openSession = async (spec: CaptureSessionSpec): Promise<CaptureSession> => {
    state.specs.push(spec);
    let current = 0;
    return {
      async setFrame(frame: number) {
        current = frame;
        state.frames.push(frame);
        hooks.onSetFrame?.(frame);
      },
      async capture() {
        if (hooks.captureError) throw new Error(hooks.captureError);
        return Buffer.from(`frame-${current}`);
      },
      async close() {
        state.closed++;
      },
    };
  };
  return { openSession, state };
}

function renderOpts(overrides: Partial<RenderJobOptions> = {}): RenderJobOptions {
  return {
    html: '<html></html>',
    style: 'satellite',
    tileCache: tmpDir(),
    width: 320,
    height: 240,
    frames: 5,
    fpsStr: '30',
    workers: 2,
    outPath: path.join(tmpDir(), 'out.mp4'),
    tools: TOOLS,
    capture: 'jpeg',
    codec: 'h264',
    quality: 'high',
    preset: 'veryfast',
    ...overrides,
  };
}

const SOURCE = path.join(tmpDir(), 'flight.mp4');

function requestFor(outPath: string, overrides: Partial<ExportRequest['config']> = {}): ExportRequest {
  return {
    outPath,
    config: {
      ...DEFAULT_CONFIG,
      width: 320,
      height: 240,
      workers: 2,
      tileCache: tmpDir(),
      ...overrides,
    },
    range: null,
  };
}

function startExport(deps: Parameters<typeof createExportRunner>[0]['deps']) {
  const outcomes: ExportOutcome[] = [];
  const logs: string[] = [];
  const events: CaptureProgress[] = [];
  const runner = createExportRunner({
    log: (msg) => logs.push(msg),
    onCapture: (progress) => events.push(progress),
    onDone: (outcome) => outcomes.push(outcome),
    deps,
  });
  const settled = () =>
    new Promise<ExportOutcome>((resolve) => {
      const tick = () => (outcomes.length ? resolve(outcomes[0]) : setTimeout(tick, 2));
      tick();
    });
  return { runner, settled, logs, events };
}

describe('the app export runs with playwright-core unresolvable', () => {
  it('completes through the injected Electron backend, frames in capture order', async () => {
    const { openSession, state } = fakeSessions();
    const out = path.join(tmpDir(), 'flight_map.mp4');
    const { runner, settled, logs, events } = startExport(
      stubDeps({
        probe: probeFixture({ frames: 250 }),
        renderVideo: createElectronRenderVideo({ openSession }),
      }),
    );

    runner.start(SOURCE, requestFor(out, { browser: '/opt/custom/chromium' }));
    const outcome = await settled();

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.summary.out).toBe(out);
    expect(fs.readFileSync(out, 'utf8')).toBe(
      Array.from({ length: 250 }, (_, i) => `frame-${i}`).join(''),
    );
    expect(events).toEqual([
      { done: 100, total: 250 },
      { done: 200, total: 250 },
      { done: 250, total: 250 },
    ]);
    expect(logs).toContain('frames: 100/250 captured');
    expect(logs).toContain('capture: electron (embedded Chromium)');
    expect(logs).toContain(
      'browser: /opt/custom/chromium is ignored (the app renders with its embedded Chromium)',
    );
    expect(logs.some((line) => line.startsWith('profile: eval='))).toBe(true);

    // Same page URL and output geometry the CLI's Playwright pages get.
    expect(state.specs).toHaveLength(2);
    for (const spec of state.specs) {
      expect(spec.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(spec).toMatchObject({ width: 320, height: 240, capture: 'jpeg' });
    }
    expect(state.closed).toBe(2);
    const dir = path.dirname(out);
    expect(fs.readdirSync(dir).filter((name) => name.includes('.partial'))).toEqual([]);
  });

  it('fails with the packaged app’s playwright-core error when no backend is injected', async () => {
    const out = path.join(tmpDir(), 'flight_map.mp4');
    // renderVideo: undefined falls back to the CLI renderer — exactly what
    // ran in installed builds before this fix.
    const { runner, settled } = startExport(stubDeps({ renderVideo: undefined }));

    runner.start(SOURCE, requestFor(out));
    const outcome = await settled();

    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') expect(outcome.error).toMatch(/playwright-core/);
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe('the Electron render driver honors the renderVideo contract', () => {
  it('rejects with the ffmpeg error when the encoder exits non-zero', async () => {
    mocks.exitCode = 3;
    const { openSession, state } = fakeSessions();
    const renderVideo = createElectronRenderVideo({ openSession });

    await expect(renderVideo(renderOpts())).rejects.toThrow('ffmpeg exited with code 3');
    expect(state.closed).toBe(state.specs.length);
  });

  it('rejects when a frame capture fails', async () => {
    const { openSession, state } = fakeSessions({ captureError: 'capture failed' });
    const renderVideo = createElectronRenderVideo({ openSession });

    await expect(renderVideo(renderOpts())).rejects.toThrow('capture failed');
    expect(state.closed).toBe(state.specs.length);
  });

  it('cancels a running render with the shared cancel error', async () => {
    const controller = new AbortController();
    const { openSession, state } = fakeSessions({
      onSetFrame: (frame) => {
        if (frame >= 2) controller.abort();
      },
    });
    const renderVideo = createElectronRenderVideo({ openSession });

    await expect(renderVideo(renderOpts({ signal: controller.signal }))).rejects.toThrow(
      ERR_RENDER_CANCELED,
    );
    expect(state.closed).toBe(state.specs.length);
  });

  it('stepped frames cover exactly frameStart..frameStart+frames-1', async () => {
    const { openSession, state } = fakeSessions();
    const renderVideo = createElectronRenderVideo({ openSession });

    await renderVideo(renderOpts({ frames: 5, frameStart: 10 }));

    expect([...state.frames].sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14]);
    expect(state.closed).toBe(state.specs.length);
  });
});

describe('the app capture path stays playwright-free', () => {
  const IMPORT_PATTERNS = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  // Import positions only: why-comments may name playwright-core.
  const PLAYWRIGHT_IMPORT = /(?:from|import|require)\s*\(?\s*['"][^'"]*playwright[^'"]*['"]/i;

  function importSpecifiers(file: string): string[] {
    const text = fs.readFileSync(file, 'utf8');
    const found = new Set<string>();
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of text.matchAll(pattern)) found.add(match[1]);
    }
    return [...found];
  }

  // Maps a runtime import onto the source file behind it: app/ loads the
  // compiled ../dist/*.js, whose sources live in src/ (*.ts).
  function resolveImport(fromFile: string, specifier: string): string | null {
    if (specifier.startsWith('node:')) return null;
    if (!specifier.startsWith('.')) return null;
    let resolved = path.resolve(path.dirname(fromFile), specifier);
    if (resolved.startsWith(path.join(root, 'dist') + path.sep)) {
      resolved = path.join(root, 'src', path.relative(path.join(root, 'dist'), resolved));
    }
    if (resolved.endsWith('.js')) {
      const ts = `${resolved.slice(0, -3)}.ts`;
      if (fs.existsSync(ts)) return ts;
    }
    return fs.existsSync(resolved) ? resolved : null;
  }

  it('never loads playwright-core from the app modules or their transitive imports', () => {
    const queue = [
      path.join(root, 'app', 'render-video.mjs'),
      path.join(root, 'app', 'electron-session.mjs'),
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (visited.has(file)) continue;
      visited.add(file);

      expect(fs.readFileSync(file, 'utf8')).not.toMatch(PLAYWRIGHT_IMPORT);
      for (const specifier of importSpecifiers(file)) {
        expect(specifier).not.toMatch(/^playwright/);
        if (!specifier.startsWith('.')) continue;
        const resolved = resolveImport(file, specifier);
        expect(resolved, `${file} imports ${specifier} but no source backs it`).not.toBeNull();
        if (resolved) queue.push(resolved);
      }
    }

    expect(visited.size).toBeGreaterThan(3);
  });
});
