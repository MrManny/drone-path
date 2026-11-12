import { describe, expect, it, vi } from 'vitest';

import type { ExportRequest } from '../../src/config.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { ExportAck, ExportOutputPayload, PickOutputResult } from '../../ui/lib/backend.js';
import {
  cancelExport,
  chooseAndExport,
  runDoneAction,
} from '../../ui/lib/exportflow.js';
import type { ExportFlowInput } from '../../ui/lib/exportflow.js';
import type { ExportEvent } from '../../ui/lib/exportstate.js';

function makeDeps() {
  return {
    pickExportOutput: vi.fn(async (): Promise<PickOutputResult> => ({
      ok: true,
      path: '/exports/a.mp4',
    })),
    startExport: vi.fn(async (_request: ExportRequest): Promise<ExportAck> => ({ ok: true })),
    cancelExport: vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
    revealExportOutput: vi.fn(async (_payload: ExportOutputPayload): Promise<ExportAck> => ({
      ok: true,
    })),
    openExportOutput: vi.fn(async (_payload: ExportOutputPayload): Promise<ExportAck> => ({
      ok: true,
    })),
  };
}

function flowRun(overrides: Partial<ReturnType<typeof makeDeps>> = {}) {
  const events: ExportEvent[] = [];
  const deps = { ...makeDeps(), ...overrides };
  return { deps, events, emit: (event: ExportEvent): void => void events.push(event) };
}

const INPUT: ExportFlowInput = {
  settings: { ...DEFAULT_CONFIG, width: 768, height: 768 },
  form: { outPath: null, width: 768, height: 768, range: null },
  segment: null,
};

describe('chooseAndExport event ordering', () => {
  it('starts nothing when the save dialog is cancelled', async () => {
    const run = flowRun({
      pickExportOutput: vi.fn(async (): Promise<PickOutputResult> => ({
        ok: false,
        canceled: true,
      })),
    });
    await chooseAndExport(run.deps, INPUT, run.emit);
    expect(run.events).toEqual([]);
    expect(run.deps.startExport).not.toHaveBeenCalled();
  });

  it('emits choose before start and starts the export with the chosen path', async () => {
    const run = flowRun();
    await chooseAndExport(run.deps, INPUT, run.emit);
    expect(run.events.map((event) => event.type)).toEqual(['choose', 'start']);
    expect(run.events[0]).toEqual({ type: 'choose', path: '/exports/a.mp4' });
    expect(run.deps.startExport).toHaveBeenCalledTimes(1);
    expect(run.deps.startExport.mock.calls[0][0]).toMatchObject({
      outPath: '/exports/a.mp4',
      range: null,
    });
  });

  it('exports the frames marked at confirm when the loop moved under the dialog', async () => {
    const run = flowRun();
    const input: ExportFlowInput = {
      ...INPUT,
      form: { ...INPUT.form, range: { start: 300, end: 360 } },
      segment: { range: { start: 60, end: 120 } },
    };
    await chooseAndExport(run.deps, input, run.emit);
    expect(run.deps.startExport.mock.calls[0][0].range).toEqual({ start: 60, end: 120 });
  });

  it('exports the full recording when a stale segment is no longer engaged', async () => {
    const run = flowRun();
    const input: ExportFlowInput = {
      ...INPUT,
      form: { ...INPUT.form, range: { start: 10, end: 29 } },
      segment: null,
    };
    await chooseAndExport(run.deps, input, run.emit);
    expect(run.deps.startExport.mock.calls[0][0].range).toBeNull();
  });

  it('carries the encoder settings into the export request', async () => {
    const run = flowRun();
    const input: ExportFlowInput = {
      ...INPUT,
      settings: {
        ...INPUT.settings,
        codec: 'h265',
        quality: 'low',
        preset: 'veryfast',
      },
    };
    await chooseAndExport(run.deps, input, run.emit);
    expect(run.deps.startExport.mock.calls[0][0].config).toMatchObject({
      codec: 'h265',
      quality: 'low',
      preset: 'veryfast',
    });
  });

  it('sends the committed sizes in the export request', async () => {
    const run = flowRun();
    const input: ExportFlowInput = {
      ...INPUT,
      form: { outPath: null, width: 768, height: 764, range: null },
    };
    await chooseAndExport(run.deps, input, run.emit);
    expect(run.deps.startExport.mock.calls[0][0].config).toMatchObject({
      width: 768,
      height: 764,
    });
  });

  it('reports a refused start with its own error after choose and start', async () => {
    const run = flowRun({
      startExport: vi.fn(async (): Promise<ExportAck> => ({
        ok: false,
        error: 'an export is already running',
      })),
    });
    await chooseAndExport(run.deps, INPUT, run.emit);
    expect(run.events.map((event) => event.type)).toEqual(['choose', 'start', 'startFailed']);
    expect(run.events[2]).toEqual({
      type: 'startFailed',
      error: 'an export is already running',
    });
  });

  it('falls back to the start vocabulary when the refusal names no error', async () => {
    const run = flowRun({
      startExport: vi.fn(async (): Promise<ExportAck> => ({ ok: false })),
    });
    await chooseAndExport(run.deps, INPUT, run.emit);
    expect(run.events[2]).toEqual({ type: 'startFailed', error: 'export could not start' });
  });

  it('reports a failed pick without starting anything', async () => {
    const run = flowRun({
      pickExportOutput: vi.fn(async (): Promise<PickOutputResult> => ({
        ok: false,
        error: 'no recording loaded',
      })),
    });
    await chooseAndExport(run.deps, INPUT, run.emit);
    expect(run.events).toEqual([{ type: 'failed', error: 'no recording loaded' }]);
    expect(run.deps.startExport).not.toHaveBeenCalled();
  });

  it('turns a thrown pick failure into a failed event', async () => {
    const run = flowRun({
      pickExportOutput: vi.fn(async (): Promise<PickOutputResult> => {
        throw new Error('the app backend went away');
      }),
    });
    await chooseAndExport(run.deps, INPUT, run.emit);
    expect(run.events).toEqual([{ type: 'failed', error: 'the app backend went away' }]);
  });
});

describe('cancelExport event ordering', () => {
  it('emits cancelRequested before the refusal', async () => {
    const run = flowRun({
      cancelExport: vi.fn(async (): Promise<ExportAck> => ({
        ok: false,
        error: 'export could not be canceled',
      })),
    });
    cancelExport(run.deps, run.emit);
    await vi.waitFor(() =>
      expect(run.events).toEqual([
        { type: 'cancelRequested' },
        { type: 'cancelFailed', error: 'export could not be canceled' },
      ]),
    );
  });

  it('falls back to the cancel vocabulary when the refusal names no error', async () => {
    const run = flowRun({
      cancelExport: vi.fn(async (): Promise<ExportAck> => ({ ok: false })),
    });
    cancelExport(run.deps, run.emit);
    await vi.waitFor(() =>
      expect(run.events).toEqual([
        { type: 'cancelRequested' },
        { type: 'cancelFailed', error: 'export could not be canceled' },
      ]),
    );
  });

  it('shows the reason when the cancel request itself fails', async () => {
    const run = flowRun({
      cancelExport: vi.fn(async (): Promise<ExportAck> => {
        throw new Error('the app backend went away');
      }),
    });
    cancelExport(run.deps, run.emit);
    await vi.waitFor(() =>
      expect(run.events).toEqual([
        { type: 'cancelRequested' },
        { type: 'cancelFailed', error: 'the app backend went away' },
      ]),
    );
  });
});

describe('runDoneAction event ordering', () => {
  it('clears the error before running the action and reports a refusal in place', async () => {
    const run = flowRun({
      revealExportOutput: vi.fn(async (): Promise<ExportAck> => ({
        ok: false,
        error: "EACCES: permission denied, open '/exports/a.mp4'",
      })),
    });
    runDoneAction(run.deps, (deps) => deps.revealExportOutput({ out: '/exports/a.mp4' }), run.emit);
    await vi.waitFor(() =>
      expect(run.events).toEqual([
        { type: 'clearError' },
        {
          type: 'failed',
          error: "EACCES: permission denied, open '/exports/a.mp4'",
        },
      ]),
    );
  });

  it('sends the action the exported path of the kept render', async () => {
    const run = flowRun();
    runDoneAction(run.deps, (deps) => deps.revealExportOutput({ out: '/exports/a.mp4' }), run.emit);
    await vi.waitFor(() => expect(run.deps.revealExportOutput).toHaveBeenCalledTimes(1));
    expect(run.deps.revealExportOutput.mock.calls[0][0]).toEqual({ out: '/exports/a.mp4' });
  });

  it('falls back to the done-action vocabulary when the refusal names no error', async () => {
    const run = flowRun({
      openExportOutput: vi.fn(async (): Promise<ExportAck> => ({ ok: false })),
    });
    runDoneAction(run.deps, (deps) => deps.openExportOutput({ out: '/exports/a.mp4' }), run.emit);
    await vi.waitFor(() =>
      expect(run.events).toEqual([{ type: 'clearError' }, { type: 'failed', error: 'action failed' }]),
    );
  });
});
