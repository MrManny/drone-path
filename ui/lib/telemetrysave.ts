import type { TelemetrySaveRequest } from '../../src/appsession.js';
import type { FrameRange } from '../../src/config.js';
import { errorMessage } from '../../src/errors.js';
import type { ExportAck, PickOutputResult } from './backend.js';
import { formatFrameRange, formatTime } from './frametime.js';

export interface TelemetrySaveDeps {
  pickTelemetryOutput(): Promise<PickOutputResult>;
  saveTelemetryJson(request: TelemetrySaveRequest): Promise<ExportAck>;
}

export type TelemetrySaveEvent =
  | { type: 'canceled' }
  | { type: 'saved'; path: string }
  | { type: 'failed'; message: string };

export type TelemetrySavePhase =
  | { kind: 'saving' }
  | { kind: 'done'; path: string; scope: string; error?: string }
  | { kind: 'error'; message: string };

export type TelemetrySaveAction =
  | { type: 'started' }
  | { type: 'result'; event: TelemetrySaveEvent; scope: string }
  | { type: 'revealFailed'; error: string };

export function telemetrySaveReducer(
  state: TelemetrySavePhase | null,
  action: TelemetrySaveAction,
): TelemetrySavePhase | null {
  switch (action.type) {
    case 'started':
      return { kind: 'saving' };
    case 'result':
      if (action.event.type === 'canceled') return state;
      return action.event.type === 'saved'
        ? { kind: 'done', path: action.event.path, scope: action.scope }
        : { kind: 'error', message: action.event.message };
    case 'revealFailed':
      return state?.kind === 'done' ? { ...state, error: action.error } : state;
  }
}

export function telemetryScope(
  range: FrameRange | null,
  fps: number,
  durationSec: number,
): string {
  return range
    ? `In–Out segment (${formatFrameRange({ in: range.start, out: range.end }, fps)})`
    : `full recording (${formatTime(durationSec)})`;
}

export async function telemetrySaveFlow(
  deps: TelemetrySaveDeps,
  range: FrameRange | null,
  onSaving: () => void,
): Promise<TelemetrySaveEvent> {
  try {
    const picked = await deps.pickTelemetryOutput();
    if (picked.canceled) return { type: 'canceled' };
    if (!picked.ok || picked.path === undefined) {
      return { type: 'failed', message: picked.error ?? 'unknown error' };
    }
    onSaving();
    const ack = await deps.saveTelemetryJson({ outPath: picked.path, range });
    if (!ack.ok) {
      return { type: 'failed', message: ack.error ?? 'telemetry JSON could not be saved' };
    }
    return { type: 'saved', path: picked.path };
  } catch (e) {
    return { type: 'failed', message: errorMessage(e) };
  }
}
