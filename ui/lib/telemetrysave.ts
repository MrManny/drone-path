// The Save telemetry JSON flow behind one event: pick the destination in the
// native save dialog, then write the document through the app backend. The
// stages only touch the app bridge through injected dependencies, so the whole
// flow runs without the DOM; `onSaving` fires once the dialog has confirmed
// and the write is about to start, so the compact dialog opens on it and a
// canceled dialog leaves the workspace untouched.
import type { TelemetrySaveRequest } from '../../src/appsession.js';
import type { FrameRange } from '../../src/config.js';
import { errorMessage } from '../../src/errors.js';
import type { ExportAck, PickOutputResult } from './backend.js';
import { formatFrameRange, formatTime } from './frametime.js';

export interface TelemetrySaveDeps {
  /** Opens the native save dialog; resolves canceled when the user backs out. */
  pickTelemetryOutput(): Promise<PickOutputResult>;
  saveTelemetryJson(request: TelemetrySaveRequest): Promise<ExportAck>;
}

export type TelemetrySaveEvent =
  | { type: 'canceled' }
  | { type: 'saved'; path: string }
  | { type: 'failed'; message: string };

/** The compact dialog's phases: the write in flight, then its outcome. */
export type TelemetrySavePhase =
  | { kind: 'saving' }
  | { kind: 'done'; path: string; error?: string }
  | { kind: 'error'; message: string };

// The one scope vocabulary for the button's title and the done dialog: an
// engaged loop saves just its In-Out segment, otherwise everything.
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
