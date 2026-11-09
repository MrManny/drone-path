import { describe, expect, it, vi } from 'vitest';

import type { TelemetrySaveRequest } from '../../src/appsession.js';
import type { ExportAck, PickOutputResult } from '../../ui/lib/backend.js';
import {
  telemetryScope,
  telemetrySaveFlow,
} from '../../ui/lib/telemetrysave.js';

const RANGE = { start: 120, end: 300 };

function deps(overrides: {
  pickTelemetryOutput?: () => Promise<PickOutputResult>;
  saveTelemetryJson?: (request: TelemetrySaveRequest) => Promise<ExportAck>;
} = {}) {
  return {
    pickTelemetryOutput:
      overrides.pickTelemetryOutput ?? vi.fn(async (): Promise<PickOutputResult> => ({ ok: true, path: '/exports/flight.telemetry.json' })),
    saveTelemetryJson:
      overrides.saveTelemetryJson ?? vi.fn(async (): Promise<ExportAck> => ({ ok: true })),
  };
}

describe('telemetrySaveFlow', () => {
  it('picks a destination, saves the range and reports the written path', async () => {
    const d = deps();
    const onSaving = vi.fn();
    const event = await telemetrySaveFlow(d, RANGE, onSaving);

    expect(event).toEqual({ type: 'saved', path: '/exports/flight.telemetry.json' });
    expect(onSaving).toHaveBeenCalledTimes(1);
    expect(d.saveTelemetryJson).toHaveBeenCalledWith({
      outPath: '/exports/flight.telemetry.json',
      range: RANGE,
    });
  });

  it('passes the full recording as a null range', async () => {
    const d = deps();
    await telemetrySaveFlow(d, null, vi.fn());
    expect(d.saveTelemetryJson).toHaveBeenCalledWith({
      outPath: '/exports/flight.telemetry.json',
      range: null,
    });
  });

  // Rainy (mandated): a canceled save dialog starts nothing - no save call,
  // no dialog, the workspace stays untouched.
  it('reports a canceled save dialog without saving anything', async () => {
    const d = deps({
      pickTelemetryOutput: vi.fn(async (): Promise<PickOutputResult> => ({
        ok: false,
        canceled: true,
      })),
    });
    const onSaving = vi.fn();
    const event = await telemetrySaveFlow(d, RANGE, onSaving);

    expect(event).toEqual({ type: 'canceled' });
    expect(d.saveTelemetryJson).not.toHaveBeenCalled();
    expect(onSaving).not.toHaveBeenCalled();
  });
});

describe.each<{
  what: string;
  pickTelemetryOutput: () => Promise<PickOutputResult>;
  message: string;
}>([
  {
    what: 'the picker reports an error',
    pickTelemetryOutput: async () => ({ ok: false, error: 'no recording loaded' }),
    message: 'no recording loaded',
  },
  {
    what: 'the picker fails without a message',
    pickTelemetryOutput: async () => ({ ok: false }),
    message: 'unknown error',
  },
  {
    what: 'the picker confirms without a path',
    pickTelemetryOutput: async () => ({ ok: true }),
    message: 'unknown error',
  },
  {
    what: 'the picker throws',
    pickTelemetryOutput: async () => {
      throw new Error('the dialog went away');
    },
    message: 'the dialog went away',
  },
])('when $what', ({ pickTelemetryOutput, message }) => {
  it('returns the failure and never reaches the save', async () => {
    const saveTelemetryJson = vi.fn(async (): Promise<ExportAck> => ({ ok: true }));
    const onSaving = vi.fn();
    const event = await telemetrySaveFlow(
      { pickTelemetryOutput, saveTelemetryJson },
      null,
      onSaving,
    );
    expect(event).toEqual({ type: 'failed', message });
    expect(saveTelemetryJson).not.toHaveBeenCalled();
    expect(onSaving).not.toHaveBeenCalled();
  });
});

describe.each<{
  what: string;
  saveTelemetryJson: (request: TelemetrySaveRequest) => Promise<ExportAck>;
  message: string;
}>([
  {
    what: 'the save is refused',
    saveTelemetryJson: async () => ({ ok: false, error: 'disk full' }),
    message: 'disk full',
  },
  {
    what: 'the save is refused without a message',
    saveTelemetryJson: async () => ({ ok: false }),
    message: 'telemetry JSON could not be saved',
  },
  {
    what: 'the save throws',
    saveTelemetryJson: async () => {
      throw new Error('the write went away');
    },
    message: 'the write went away',
  },
])('when $what', ({ saveTelemetryJson, message }) => {
  it('opens the dialog on the pick confirm and reports the failure', async () => {
    const onSaving = vi.fn();
    const event = await telemetrySaveFlow(
      { pickTelemetryOutput: async () => ({ ok: true, path: '/exports/a.json' }), saveTelemetryJson },
      null,
      onSaving,
    );
    expect(event).toEqual({ type: 'failed', message });
    expect(onSaving).toHaveBeenCalledTimes(1);
  });
});

describe('telemetryScope', () => {
  it('names the full recording without a loop', () => {
    expect(telemetryScope(null, 30, 10)).toBe('full recording (0:10)');
  });

  it('names the In-Out segment with its frames', () => {
    expect(telemetryScope(RANGE, 30, 10)).toBe('In–Out segment (0:04–0:10 · 181 frames)');
  });
});
