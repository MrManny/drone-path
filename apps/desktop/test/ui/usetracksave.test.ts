// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrackSaveRequest } from '../../shared/contracts.js';
import { useTrackSave } from '../../ui/hooks/useTrackSave.js';
import type { ExportAck, ExportOutputPayload, PickOutputResult } from '../../ui/lib/backend.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { dronepath?: unknown }).dronepath;
});

const DONE = {
  kind: 'done' as const,
  path: '/exports/flight.telemetry.json',
  scope: 'full recording (0:10)',
};

interface BridgeOverrides {
  pickTrackOutput?: () => Promise<PickOutputResult>;
  saveTrack?: (request: TrackSaveRequest) => Promise<ExportAck>;
  revealExportOutput?: (payload: ExportOutputPayload) => Promise<ExportAck>;
}

function installBridge(overrides: BridgeOverrides = {}) {
  const bridge = {
    pickTrackOutput: vi.fn(
      overrides.pickTrackOutput ??
        (async (): Promise<PickOutputResult> => ({
          ok: true,
          path: '/exports/flight.telemetry.json',
        })),
    ),
    saveTrack: vi.fn(
      overrides.saveTrack ??
        (async (_request: TrackSaveRequest): Promise<ExportAck> => ({ ok: true })),
    ),
    revealExportOutput: vi.fn(
      overrides.revealExportOutput ??
        (async (_payload: ExportOutputPayload): Promise<ExportAck> => ({ ok: true })),
    ),
  };
  (window as { dronepath?: unknown }).dronepath = bridge;
  return bridge;
}

function mountTrackSave() {
  const onOpen = vi.fn();
  const view = renderHook(() => useTrackSave({ onOpen }));
  const save = (): void => {
    act(() => {
      view.result.current.save(null, 'full recording (0:10)');
    });
  };
  const reveal = (): void => {
    act(() => {
      view.result.current.reveal();
    });
  };
  const reset = (): void => {
    act(() => {
      view.result.current.reset();
    });
  };
  const reachDone = async (): Promise<void> => {
    save();
    await waitFor(() => expect(view.result.current.phase).toEqual(DONE));
  };
  return { result: view.result, onOpen, save, reveal, reset, reachDone, unmount: view.unmount };
}

describe('useTrackSave save', () => {
  it('lands on done with the written path and the scope', async () => {
    const bridge = installBridge();
    const track = mountTrackSave();
    await track.reachDone();
    expect(track.result.current.phase).toEqual(DONE);
    expect(bridge.saveTrack).toHaveBeenCalledWith({
      outPath: '/exports/flight.telemetry.json',
      range: null,
    });
  });

  it('reports a refused save as the error phase', async () => {
    installBridge({ saveTrack: async () => ({ ok: false, error: 'disk full' }) });
    const track = mountTrackSave();
    track.save();
    await waitFor(() =>
      expect(track.result.current.phase).toEqual({ kind: 'error', message: 'disk full' }),
    );
  });

  it('ignores duplicate concurrent save triggers while the picker is open and unlocks afterward (#313)', async () => {
    let resolvePick: (result: PickOutputResult) => void = () => {};
    const bridge = installBridge({
      pickTrackOutput: () =>
        new Promise<PickOutputResult>((resolve) => {
          resolvePick = resolve;
        }),
    });
    const track = mountTrackSave();
    track.save();
    track.save();
    expect(bridge.pickTrackOutput).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePick({ ok: false, canceled: true });
    });

    track.save();
    expect(bridge.pickTrackOutput).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolvePick({ ok: true, path: '/exports/flight.telemetry.json' });
    });
    await waitFor(() => expect(track.result.current.phase).toEqual(DONE));
  });

  it('aborts save and skips dispatchDialog if unmounted while the picker is pending (#313)', async () => {
    let resolvePick: (result: PickOutputResult) => void = () => {};
    const bridge = installBridge({
      pickTrackOutput: () =>
        new Promise<PickOutputResult>((resolve) => {
          resolvePick = resolve;
        }),
    });
    const track = mountTrackSave();
    track.save();
    track.unmount();

    await act(async () => {
      resolvePick({ ok: true, path: '/exports/flight.telemetry.json' });
    });
    expect(bridge.saveTrack).not.toHaveBeenCalled();
    expect(track.onOpen).not.toHaveBeenCalled();
  });

  it('skips onOpen if unmounted when the picker rejects (#313)', async () => {
    let rejectPick: (reason: Error) => void = () => {};
    installBridge({
      pickTrackOutput: () =>
        new Promise<PickOutputResult>((_resolve, reject) => {
          rejectPick = reject;
        }),
    });
    const track = mountTrackSave();
    track.save();
    track.unmount();

    await act(async () => {
      rejectPick(new Error('picker failed'));
    });
    expect(track.onOpen).not.toHaveBeenCalled();
  });

  it('aborts an in-flight save and unlocks on reset (#392)', async () => {
    let resolvePick: (result: PickOutputResult) => void = () => {};
    const bridge = installBridge({
      pickTrackOutput: () =>
        new Promise<PickOutputResult>((resolve) => {
          resolvePick = resolve;
        }),
    });
    const track = mountTrackSave();
    track.save();
    track.reset();

    await act(async () => {
      resolvePick({ ok: true, path: '/exports/flight.telemetry.json' });
    });
    expect(bridge.saveTrack).not.toHaveBeenCalled();
    expect(track.onOpen).not.toHaveBeenCalled();
    expect(track.result.current.phase).toBeNull();

    track.save();
    expect(bridge.pickTrackOutput).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolvePick({ ok: true, path: '/exports/flight.telemetry.json' });
    });
    await waitFor(() => expect(track.result.current.phase).toEqual(DONE));
  });
});

describe('useTrackSave reveal', () => {
  it('reveals the written file and keeps the done phase clean on success', async () => {
    const bridge = installBridge();
    const track = mountTrackSave();
    await track.reachDone();
    track.reveal();
    await waitFor(() => expect(bridge.revealExportOutput).toHaveBeenCalledTimes(1));
    expect(bridge.revealExportOutput.mock.calls[0][0]).toEqual({
      out: '/exports/flight.telemetry.json',
    });
    expect(track.result.current.phase).toStrictEqual(DONE);
  });

  describe.each<{
    what: string;
    revealExportOutput: (payload: ExportOutputPayload) => Promise<ExportAck>;
    message: string;
  }>([
    {
      what: 'the reveal is refused',
      revealExportOutput: async () => ({ ok: false, error: 'the folder is missing' }),
      message: 'the folder is missing',
    },
    {
      what: 'the reveal is refused without a message',
      revealExportOutput: async () => ({ ok: false }),
      message: 'the file could not be revealed',
    },
    {
      what: 'the reveal throws',
      revealExportOutput: async () => {
        throw new Error('the app backend went away');
      },
      message: 'the app backend went away',
    },
  ])('when $what', ({ revealExportOutput, message }) => {
    it('surfaces the failure on the done phase', async () => {
      installBridge({ revealExportOutput });
      const track = mountTrackSave();
      await track.reachDone();
      track.reveal();
      await waitFor(() =>
        expect(track.result.current.phase).toEqual({ ...DONE, error: message }),
      );
    });
  });

  it('drops a stale reveal failure once a retry succeeds (#286)', async () => {
    const bridge = installBridge({
      revealExportOutput: async () => ({ ok: false, error: 'the folder is missing' }),
    });
    const track = mountTrackSave();
    await track.reachDone();
    track.reveal();
    await waitFor(() =>
      expect(track.result.current.phase).toEqual({ ...DONE, error: 'the folder is missing' }),
    );
    bridge.revealExportOutput.mockResolvedValue({ ok: true });
    track.reveal();
    await waitFor(() => expect(track.result.current.phase).toStrictEqual(DONE));
  });

  it('clears a stale reveal failure before the retry resolves (#286)', async () => {
    const bridge = installBridge({
      revealExportOutput: async () => ({ ok: false, error: 'the folder is missing' }),
    });
    const track = mountTrackSave();
    await track.reachDone();
    track.reveal();
    await waitFor(() =>
      expect(track.result.current.phase).toEqual({ ...DONE, error: 'the folder is missing' }),
    );
    let settleReveal = (_ack: ExportAck): void => {};
    bridge.revealExportOutput.mockImplementation(
      () =>
        new Promise<ExportAck>((resolve) => {
          settleReveal = resolve;
        }),
    );
    track.reveal();
    expect(bridge.revealExportOutput).toHaveBeenCalledTimes(2);
    // The stale failure is already gone while the retry is still in flight.
    expect(track.result.current.phase).toStrictEqual(DONE);
    settleReveal({ ok: true });
    await act(async () => {});
    expect(track.result.current.phase).toStrictEqual(DONE);
  });

  it('does nothing before a save reached done', () => {
    const bridge = installBridge();
    const track = mountTrackSave();
    track.reveal();
    expect(bridge.revealExportOutput).not.toHaveBeenCalled();
    expect(track.result.current.phase).toBeNull();
  });

  it('does nothing after a failed save', async () => {
    const bridge = installBridge({ saveTrack: async () => ({ ok: false, error: 'disk full' }) });
    const track = mountTrackSave();
    track.save();
    await waitFor(() =>
      expect(track.result.current.phase).toEqual({ kind: 'error', message: 'disk full' }),
    );
    track.reveal();
    expect(bridge.revealExportOutput).not.toHaveBeenCalled();
    expect(track.result.current.phase).toEqual({ kind: 'error', message: 'disk full' });
  });

  it('ignores duplicate concurrent reveal calls while one is in flight (#313)', async () => {
    let settleReveal: (ack: ExportAck) => void = () => {};
    const bridge = installBridge({
      revealExportOutput: () =>
        new Promise<ExportAck>((resolve) => {
          settleReveal = resolve;
        }),
    });
    const track = mountTrackSave();
    await track.reachDone();

    track.reveal();
    track.reveal();
    expect(bridge.revealExportOutput).toHaveBeenCalledTimes(1);

    settleReveal({ ok: true });
    await act(async () => {});

    track.reveal();
    expect(bridge.revealExportOutput).toHaveBeenCalledTimes(2);
    settleReveal({ ok: true });
    await act(async () => {});
  });

  it('ignores reveal refusal if unmounted while reveal is pending (#313)', async () => {
    let settleReveal: (ack: ExportAck) => void = () => {};
    const bridge = installBridge({
      revealExportOutput: () =>
        new Promise<ExportAck>((resolve) => {
          settleReveal = resolve;
        }),
    });
    const track = mountTrackSave();
    await track.reachDone();

    track.reveal();
    expect(bridge.revealExportOutput).toHaveBeenCalledTimes(1);
    track.unmount();

    settleReveal({ ok: false, error: 'the folder is missing' });
    await act(async () => {});
    expect(track.result.current.phase).toEqual(DONE);
  });
});
