import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openElectronSession } from '../app/electron-session.mjs';
import type { CaptureSessionSpec } from '../app/electron-session.mjs';

interface FakeImage {
  getSize(): { width: number; height: number };
  resize(size: { width: number; height: number }): FakeImage;
  toJPEG(quality: number): Buffer;
  toPNG(): Buffer;
}

function makeImage(
  size: { width: number; height: number },
  handlers: Partial<Pick<FakeImage, 'resize' | 'toJPEG' | 'toPNG'>> = {},
): FakeImage {
  return {
    getSize: () => size,
    resize: handlers.resize ?? ((s) => makeImage(s)),
    toJPEG: handlers.toJPEG ?? (() => Buffer.from('jpeg-bytes')),
    toPNG: handlers.toPNG ?? (() => Buffer.from('png-bytes')),
  };
}

const harness = vi.hoisted(() => {
  const state: { loadError: unknown; loadHangs: boolean; captureHangs: boolean } = {
    loadError: null,
    loadHangs: false,
    captureHangs: false,
  };

  class FakeWebContents {
    emulation: unknown = null;
    codes: string[] = [];
    jsResults: unknown[] = [];
    image: unknown = null;

    enableDeviceEmulation(params: unknown): void {
      this.emulation = params;
    }

    async executeJavaScript(code: string): Promise<unknown> {
      this.codes.push(code);
      return this.jsResults.shift();
    }

    async capturePage(): Promise<unknown> {
      if (state.captureHangs) return new Promise<never>(() => {});
      return this.image;
    }
  }

  class FakeBrowserWindow {
    readonly opts: Record<string, unknown>;
    readonly contents = new FakeWebContents();
    readonly webContents: FakeWebContents;
    destroyed = false;
    loadedUrl: string | null = null;

    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      this.webContents = this.contents;
      windows.push(this);
    }

    async loadURL(url: string): Promise<string> {
      this.loadedUrl = url;
      if (state.loadHangs) return new Promise<never>(() => {});
      if (state.loadError) throw state.loadError;
      return 'ok';
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    destroy(): void {
      this.destroyed = true;
    }
  }

  const windows: FakeBrowserWindow[] = [];
  return { windows, state, FakeBrowserWindow, FakeWebContents };
});

vi.mock('electron', () => ({ BrowserWindow: harness.FakeBrowserWindow }));

function spec(overrides: Partial<CaptureSessionSpec> = {}): CaptureSessionSpec {
  return {
    url: 'http://127.0.0.1:4321/',
    width: 320,
    height: 240,
    capture: 'jpeg',
    ...overrides,
  };
}

function windowAt(index = 0): InstanceType<typeof harness.FakeBrowserWindow> {
  const win = harness.windows[index];
  if (!win) throw new Error(`no window created at index ${index}`);
  return win;
}

beforeEach(() => {
  harness.windows.length = 0;
  harness.state.loadError = null;
  harness.state.loadHangs = false;
  harness.state.captureHangs = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('openElectronSession window setup', () => {
  it('creates a hidden, sandboxed window at the output size', async () => {
    await openElectronSession(spec());

    const win = windowAt();
    expect(win.opts).toMatchObject({
      show: false,
      useContentSize: true,
      width: 320,
      height: 240,
    });
    expect(win.opts.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    });
  });

  it('pins device emulation to scale 1 so captures match the output size', async () => {
    await openElectronSession(spec());

    expect(windowAt().contents.emulation).toEqual({
      screenPosition: 'desktop',
      screenSize: { width: 320, height: 240 },
      viewSize: { width: 320, height: 240 },
      deviceScaleFactor: 1,
    });
  });

  it('loads the render URL and gates on __READY before the first frame', async () => {
    const session = await openElectronSession(spec());

    const win = windowAt();
    expect(win.loadedUrl).toBe('http://127.0.0.1:4321/');
    expect(win.contents.codes[0]).toContain('__READY');
    await session.setFrame(7);
    expect(win.contents.codes[1]).toContain('__setFrame(7)');
  });

  it('destroys the window when the page fails to load', async () => {
    harness.state.loadError = new Error('load failed');

    await expect(openElectronSession(spec())).rejects.toThrow('load failed');
    expect(windowAt().destroyed).toBe(true);
  });
});

describe('openElectronSession capture', () => {
  it('emits JPEG frames at the shared capture quality', async () => {
    const qualities: number[] = [];
    const session = await openElectronSession(spec({ capture: 'jpeg' }));
    windowAt().contents.image = makeImage(
      { width: 320, height: 240 },
      { toJPEG: (q) => (qualities.push(q), Buffer.from('jpeg-bytes')) },
    );

    await expect(session.capture()).resolves.toEqual(Buffer.from('jpeg-bytes'));
    expect(qualities).toEqual([95]);
  });

  it('emits PNG frames losslessly', async () => {
    const session = await openElectronSession(spec({ capture: 'png' }));
    const toJPEG = vi.fn(() => Buffer.from('jpeg-bytes'));
    windowAt().contents.image = makeImage({ width: 320, height: 240 }, { toJPEG });

    await expect(session.capture()).resolves.toEqual(Buffer.from('png-bytes'));
    expect(toJPEG).not.toHaveBeenCalled();
  });

  it('resizes a scaled capture back to the output size before encoding', async () => {
    const resize = vi.fn((size: { width: number; height: number }) =>
      makeImage(size, { toJPEG: () => Buffer.from('resized-jpeg') }),
    );
    const session = await openElectronSession(spec());
    windowAt().contents.image = makeImage({ width: 640, height: 480 }, { resize });

    await expect(session.capture()).resolves.toEqual(Buffer.from('resized-jpeg'));
    expect(resize).toHaveBeenCalledWith({ width: 320, height: 240 });
  });
});

describe('openElectronSession lifecycle', () => {
  it('destroys the window on close, and close is idempotent', async () => {
    const session = await openElectronSession(spec());

    await session.close();
    await session.close();

    expect(windowAt().destroyed).toBe(true);
  });
});

describe('openElectronSession timeouts', () => {
  const TIMEOUT_MS = 60000;

  it('fails the session when the page never becomes ready, and destroys the window', async () => {
    vi.useFakeTimers();
    const settled = openElectronSession(spec()).then(
      () => null,
      (e: unknown) => e as Error,
    );
    // The ready poll's executeJavaScript resolves with a promise that never
    // settles: a page whose boot failed before bootScene's own ready timer.
    windowAt().contents.jsResults.push(new Promise<never>(() => {}));
    for (let i = 0; i < 10 && windowAt().contents.codes.length === 0; i++) {
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    const err = await settled;
    expect(err?.message).toBe('render page did not become ready in 60s');
    expect(windowAt().destroyed).toBe(true);
  });

  it('fails the session when the page load hangs, and destroys the window', async () => {
    harness.state.loadHangs = true;
    vi.useFakeTimers();
    const settled = openElectronSession(spec()).then(
      () => null,
      (e: unknown) => e as Error,
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    const err = await settled;
    expect(err?.message).toBe('page load timed out after 60s');
    expect(windowAt().destroyed).toBe(true);
  });

  it('fails a frame capture that never completes', async () => {
    const session = await openElectronSession(spec());
    harness.state.captureHangs = true;
    vi.useFakeTimers();
    const settled = session.capture().then(
      () => null,
      (e: unknown) => e as Error,
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    const err = await settled;
    expect(err?.message).toBe('frame capture timed out after 60s');
  });
});
