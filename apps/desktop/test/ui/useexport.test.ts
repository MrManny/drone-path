// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import type { ExportRequest } from 'drone-path-engine/config';
import type { ExportOutcome } from '../../shared/ipc.js';
import type { CaptureProgress } from 'drone-path-engine/render';
import { useExport } from '../../ui/hooks/useExport.js';
import type { ExportAck, PickOutputResult } from '../../ui/lib/backend.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { dronepath?: unknown }).dronepath;
});

const SUMMARY = {
  video: '/v.mp4',
  out: '/exports/a.mp4',
  status: 'ok' as const,
  elapsedSec: 4,
  frames: 120,
  fps: '30',
  width: 1280,
  height: 720,
};

function installBridge(overrides: Partial<Record<string, unknown>> = {}) {
  const listeners: {
    capture?: (progress: CaptureProgress) => void;
    done?: (outcome: ExportOutcome) => void;
  } = {};
  const bridge = {
    pickExportOutput: vi.fn(async (): Promise<PickOutputResult> => ({ ok: true, path: '/exports/a.mp4' })),
    startExport: vi.fn(async (_request: ExportRequest): Promise<ExportAck> => ({ ok: true })),
    cancelExport: vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
    revealExportOutput: vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
    openExportOutput: vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
    onExportCapture: vi.fn((cb: (progress: CaptureProgress) => void) => {
      listeners.capture = cb;
      return () => {
        listeners.capture = undefined;
      };
    }),
    onExportDone: vi.fn((cb: (outcome: ExportOutcome) => void) => {
      listeners.done = cb;
      return () => {
        listeners.done = undefined;
      };
    }),
    ...overrides,
  };
  (window as { dronepath?: unknown }).dronepath = bridge;
  return {
    bridge,
    emitCapture: (progress: CaptureProgress) => {
      act(() => {
        listeners.capture?.(progress);
      });
    },
    emitDone: (outcome: ExportOutcome) => {
      act(() => {
        listeners.done?.(outcome);
      });
    },
  };
}

describe('useExport', () => {
  it('starts closed and initializes from settings and loop on open', () => {
    const { result } = renderHook(() => useExport());
    expect(result.current.state).toBeNull();
    expect(result.current.busy).toBe(false);

    act(() => {
      result.current.open(DEFAULT_CONFIG, { in: 10, out: 50 }, 100);
    });
    expect(result.current.state?.phase).toBe('form');
    expect(result.current.state?.form).toEqual({
      width: DEFAULT_CONFIG.width,
      height: DEFAULT_CONFIG.height,
      range: { start: 10, end: 50 },
    });
  });

  it('remembers committed sizes across close/open and forgets them on recording reset', () => {
    const { result } = renderHook(() => useExport());
    act(() => {
      result.current.open(DEFAULT_CONFIG, { in: null, out: null }, 100);
    });
    act(() => {
      result.current.dispatch({ type: 'setWidth', width: 1025 });
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.state).toBeNull();

    act(() => {
      result.current.open(DEFAULT_CONFIG, { in: null, out: null }, 100);
    });
    expect(result.current.state?.form.width).toBe(1024);

    act(() => {
      result.current.reset();
      result.current.open(DEFAULT_CONFIG, { in: null, out: null }, 100);
    });
    expect(result.current.state?.form.width).toBe(DEFAULT_CONFIG.width);
  });

  it('tracks busy directly from running phase and clears on completion', async () => {
    const { emitCapture, emitDone } = installBridge();
    const { result } = renderHook(() => useExport());
    act(() => {
      result.current.open(DEFAULT_CONFIG, { in: null, out: null }, 100);
    });
    act(() => {
      result.current.start(DEFAULT_CONFIG, null);
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    emitCapture({ done: 1, total: 2 });
    expect(result.current.state?.capture).toEqual({ done: 1, total: 2 });
    emitDone({ status: 'ok', summary: SUMMARY });
    expect(result.current.busy).toBe(false);
    expect(result.current.state?.phase).toBe('done');
  });

  it('aborts a pending save picker cleanly on reset for a recording switch (#392)', async () => {
    let resolvePick: (result: PickOutputResult) => void = () => {};
    const { bridge } = installBridge({
      pickExportOutput: vi.fn(
        () =>
          new Promise<PickOutputResult>((resolve) => {
            resolvePick = resolve;
          }),
      ),
    });
    const { result } = renderHook(() => useExport());
    act(() => {
      result.current.open(DEFAULT_CONFIG, { in: null, out: null }, 100);
    });
    act(() => {
      result.current.start(DEFAULT_CONFIG, null);
    });
    act(() => {
      result.current.reset();
    });

    await act(async () => {
      resolvePick({ ok: true, path: '/exports/a.mp4' });
    });
    expect(bridge.startExport).not.toHaveBeenCalled();
    expect(result.current.state).toBeNull();
    expect(result.current.busy).toBe(false);
  });
});
