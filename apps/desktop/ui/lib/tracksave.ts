import { tEnglish } from '../../shared/desktop-i18n/loader.js';
import type { Translate } from '../../shared/desktop-i18n/loader.js';
import { classifyError, fromIpcFailure, structuredError } from '../../shared/errors.js';
import type { StructuredError } from '../../shared/errors.js';
import type { TrackSaveRequest } from '../../shared/ipc.js';
import type { FrameRange } from 'drone-path-core/frame-range';
import type { ExportAck, PickOutputResult } from './backend.js';
import { formatFrameRange, formatTime } from './frametime.js';

interface TrackSaveDeps {
  pickTrackOutput(): Promise<PickOutputResult>;
  saveTrack(request: TrackSaveRequest): Promise<ExportAck>;
}

type TrackSaveEvent =
  | { type: 'canceled' }
  | { type: 'saved'; path: string }
  | { type: 'failed'; error: StructuredError };

export type TrackSavePhase =
  | { kind: 'saving' }
  | { kind: 'done'; path: string; scope: string; error?: StructuredError }
  | { kind: 'error'; error: StructuredError };

type TrackSaveAction =
  | { type: 'started' }
  | { type: 'result'; event: TrackSaveEvent; scope: string }
  | { type: 'clearError' }
  | { type: 'revealFailed'; error: StructuredError }
  | { type: 'reset' };

// The persistent phase line; the failure phase announces through its alert
// notice, so it leaves the line empty.
export function trackPhaseText(phase: TrackSavePhase, t: Translate = tEnglish): string {
  switch (phase.kind) {
    case 'saving':
      return t('tracksave.saving');
    case 'done':
      return t('tracksave.finished');
    case 'error':
      return '';
  }
}

export function trackSaveReducer(
  state: TrackSavePhase | null,
  action: TrackSaveAction,
): TrackSavePhase | null {
  switch (action.type) {
    case 'started':
      return { kind: 'saving' };
    case 'result':
      if (action.event.type === 'canceled') return state;
      return action.event.type === 'saved'
        ? { kind: 'done', path: action.event.path, scope: action.scope }
        : { kind: 'error', error: action.event.error };
    case 'clearError':
      return state?.kind === 'done' && state.error !== undefined
        ? { kind: 'done', path: state.path, scope: state.scope }
        : state;
    case 'revealFailed':
      return state?.kind === 'done' ? { ...state, error: action.error } : state;
    case 'reset':
      return null;
  }
}

export function trackScope(
  range: FrameRange | null,
  fps: number,
  durationSec: number,
  t: Translate = tEnglish,
): string {
  return range
    ? t('tracksave.segment', { range: formatFrameRange({ in: range.start, out: range.end }, fps, t) })
    : t('tracksave.fullRecording', { duration: formatTime(durationSec) });
}

export async function trackSaveFlow(
  deps: TrackSaveDeps,
  range: FrameRange | null,
  onSaving: () => void,
  isMounted: () => boolean = () => true,
): Promise<TrackSaveEvent> {
  try {
    const picked = await deps.pickTrackOutput();
    if (!isMounted()) return { type: 'canceled' };
    if (!picked.ok) {
      return picked.canceled
        ? { type: 'canceled' }
        : { type: 'failed', error: fromIpcFailure(picked, 'UNKNOWN') };
    }
    if (picked.path === undefined) {
      return { type: 'failed', error: structuredError('UNKNOWN') };
    }
    onSaving();
    const ack = await deps.saveTrack({ outPath: picked.path, range });
    if (!ack.ok) {
      return { type: 'failed', error: fromIpcFailure(ack, 'TRACK_SAVE_FAILED') };
    }
    return { type: 'saved', path: picked.path };
  } catch (e) {
    return { type: 'failed', error: classifyError(e, 'BACKEND_ERROR') };
  }
}
