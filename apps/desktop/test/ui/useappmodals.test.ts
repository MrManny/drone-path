// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import type { ExportAck, PickOutputResult } from '../../ui/lib/backend.js';
import { useAppModals } from '../../ui/hooks/useAppModals.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { dronepath?: unknown }).dronepath;
});

function installBridge() {
  const listeners: {
    updateReady?: () => void;
    restartFailed?: (message: string) => void;
  } = {};
  const bridge = {
    pickExportOutput: vi.fn(async (): Promise<PickOutputResult> => ({ ok: true, path: '/exports/a.mp4' })),
    startExport: vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
    cancelExport: vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
    pickTrackOutput: vi.fn(async (): Promise<PickOutputResult> => ({ ok: true, path: '/exports/a.json' })),
    saveTrack: vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
    onUpdateReady: vi.fn((cb: () => void) => {
      listeners.updateReady = cb;
      return () => {
        listeners.updateReady = undefined;
      };
    }),
    onUpdateRestartFailed: vi.fn((cb: (message: string) => void) => {
      listeners.restartFailed = cb;
      return () => {
        listeners.restartFailed = undefined;
      };
    }),
    getUpdateState: vi.fn(async () => ({ ready: false })),
    restartToUpdate: vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
  };
  (window as { dronepath?: unknown }).dronepath = bridge;
  return {
    bridge,
    emitUpdateReady: () => {
      act(() => {
        listeners.updateReady?.();
      });
    },
    emitRestartFailed: (message: string) => {
      act(() => {
        listeners.restartFailed?.(message);
      });
    },
  };
}

describe('useAppModals', () => {
  it('promotes a waiting update prompt when a blocking dialog closes without effect lag', () => {
    const { emitUpdateReady } = installBridge();
    const { result } = renderHook(() => useAppModals());

    act(() => {
      result.current.dialogs.dispatchDialog({ type: 'openHelp' });
    });
    emitUpdateReady();
    expect(result.current.dialogs.active).toBe('help');
    expect(result.current.update.phase).toBe('ready');

    act(() => {
      result.current.dialogs.dispatchDialog({ type: 'close' });
    });
    expect(result.current.dialogs.active).toBe('update');
    expect(result.current.update.phase).toBe('prompted');

    act(() => {
      result.current.dialogs.dispatchDialog({ type: 'close' });
    });
    expect(result.current.dialogs.active).toBe('closed');
    expect(result.current.dialogs.modalOpen).toBe(false);
  });

  it('derives update busy state directly from update.phase without runStarted/runFinished', async () => {
    const { bridge, emitUpdateReady, emitRestartFailed } = installBridge();
    bridge.restartToUpdate.mockReturnValueOnce(new Promise<ExportAck>(() => {}));
    const { result } = renderHook(() => useAppModals());

    emitUpdateReady();
    expect(result.current.dialogs.active).toBe('update');
    expect(result.current.dialogs.dismissible).toBe(true);

    act(() => {
      result.current.restartUpdate();
    });
    expect(result.current.update.phase).toBe('restarting');
    expect(result.current.dialogs.dismissible).toBe(false);

    act(() => {
      result.current.dialogs.dispatchDialog({ type: 'close' });
    });
    expect(result.current.dialogs.active).toBe('update');

    emitRestartFailed('restart boom');
    expect(result.current.update.phase).toBe('prompted');
    expect(result.current.update.failure).toBe('restart boom');
    expect(result.current.dialogs.dismissible).toBe(true);
  });

  it('resets player-owned export and track-save state on recording switch (#392)', async () => {
    let resolveSave: (ack: ExportAck) => void = () => {};
    const { bridge } = installBridge();
    bridge.saveTrack.mockImplementationOnce(
      () =>
        new Promise<ExportAck>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { result } = renderHook(() => useAppModals());

    act(() => {
      result.current.openTrackSave(null, 'full recording (0:03)');
    });
    await waitFor(() => expect(result.current.dialogs.active).toBe('track-save'));
    expect(result.current.dialogs.dismissible).toBe(false);

    act(() => {
      result.current.resetForRecording();
    });
    expect(result.current.dialogs.active).toBe('closed');
    expect(result.current.dialogs.modalOpen).toBe(false);
    expect(result.current.trackSave.phase).toBeNull();

    await act(async () => {
      resolveSave({ ok: true });
    });
    expect(result.current.dialogs.modalOpen).toBe(false);
  });

  it('clears export state when closing via dispatchDialog', () => {
    const { result } = renderHook(() => useAppModals());
    act(() => {
      result.current.openExport(DEFAULT_CONFIG, { in: null, out: null }, 90);
    });
    expect(result.current.dialogs.active).toBe('export');
    expect(result.current.exportFlow.state).not.toBeNull();

    act(() => {
      result.current.dialogs.dispatchDialog({ type: 'close' });
    });
    expect(result.current.dialogs.active).toBe('closed');
    expect(result.current.exportFlow.state).toBeNull();
  });
});
