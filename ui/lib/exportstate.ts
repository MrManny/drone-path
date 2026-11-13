import type { ExportRequest, FrameRange } from '../../src/config.js';
import { normalizeDimensions } from '../../src/config.js';
import type { ExportOutcome } from '../../src/exportjob.js';
import type { CaptureProgress } from '../../src/render.js';
import type { RecordingSummary } from '../../src/pipeline.js';

type ExportPhase = 'form' | 'running' | 'done' | 'error' | 'canceled';

const LOG_CAP = 50;

export function captureFraction(capture: CaptureProgress | null): number | null {
  if (!capture) return null;
  return capture.total > 0 ? Math.min(1, capture.done / capture.total) : null;
}

export function runningPhaseText(fraction: number | null, canceling: boolean): string {
  if (canceling) return 'Canceling…';
  return fraction === null ? 'Preparing…' : `Exporting ${Math.round(fraction * 100)}%`;
}

// The persistent phase line carries the running progress and the result
// sentences; the form and failure phases announce through their own notices,
// so they leave it empty.
export function exportPhaseText(state: ExportState): string {
  switch (state.phase) {
    case 'form':
      return '';
    case 'running':
      return runningPhaseText(captureFraction(state.capture), state.canceling);
    case 'done':
      return 'Export finished.';
    case 'canceled':
      return 'Export canceled; its unfinished file was removed.';
    case 'error':
      return '';
  }
}

export function previewFrame(range: FrameRange | null, frames: number): number {
  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, frames - 1);
  return Math.max(0, Math.min(Math.max(0, frames - 1), Math.round((start + end) / 2)));
}

export interface ExportForm {
  outPath: string | null;
  width: number;
  height: number;
  range: FrameRange | null;
}

export interface ExportState {
  phase: ExportPhase;
  form: ExportForm;
  request: ExportRequest | null;
  messages: string[];
  capture: CaptureProgress | null;
  result: RecordingSummary | null;
  error: string | null;
  canceling: boolean;
}

export type ExportEvent =
  | { type: 'choose'; path: string }
  | { type: 'setWidth'; width: number }
  | { type: 'setHeight'; height: number }
  | { type: 'setRange'; range: FrameRange | null }
  | { type: 'failed'; error: string }
  | { type: 'start'; request: ExportRequest }
  | { type: 'startFailed'; error: string }
  | { type: 'progress'; message: string }
  | { type: 'capture'; progress: CaptureProgress }
  | { type: 'cancelRequested' }
  | { type: 'cancelFailed'; error: string }
  | { type: 'clearError' }
  | { type: 'finish'; outcome: ExportOutcome };

export function initialExportState(
  width: number,
  height: number,
  range: FrameRange | null = null,
): ExportState {
  return {
    phase: 'form',
    form: { outPath: null, ...normalizeDimensions(width, height), range },
    request: null,
    messages: [],
    capture: null,
    result: null,
    error: null,
    canceling: false,
  };
}

export function exportReducer(state: ExportState, event: ExportEvent): ExportState {
  switch (event.type) {
    case 'choose':
      return state.phase === 'form'
        ? { ...state, form: { ...state.form, outPath: event.path }, error: null }
        : state;
    case 'setWidth':
      return state.phase === 'form'
        ? {
            ...state,
            form: { ...state.form, ...normalizeDimensions(event.width, state.form.height) },
            error: null,
          }
        : state;
    case 'setHeight':
      return state.phase === 'form'
        ? {
            ...state,
            form: { ...state.form, ...normalizeDimensions(state.form.width, event.height) },
            error: null,
          }
        : state;
    case 'setRange':
      return state.phase === 'form'
        ? { ...state, form: { ...state.form, range: event.range }, error: null }
        : state;
    case 'failed':
      return { ...state, error: event.error };
    case 'start':
      return state.phase === 'form'
        ? {
            ...state,
            phase: 'running',
            request: event.request,
            messages: [],
            capture: null,
            result: null,
            error: null,
            canceling: false,
          }
        : state;
    case 'startFailed':
      return state.phase === 'running'
        ? { ...state, phase: 'form', request: null, error: event.error }
        : state;
    case 'progress':
      return state.phase === 'running'
        ? {
            ...state,
            messages: [...state.messages, event.message].slice(-LOG_CAP),
          }
        : state;
    case 'capture':
      return state.phase === 'running'
        ? { ...state, capture: event.progress }
        : state;
    case 'cancelRequested':
      return state.phase === 'running' ? { ...state, canceling: true, error: null } : state;
    case 'cancelFailed':
      return state.phase === 'running' ? { ...state, canceling: false, error: event.error } : state;
    case 'clearError':
      return { ...state, error: null };
    case 'finish': {
      if (state.phase !== 'running') return state;
      const { outcome } = event;
      if (outcome.status === 'ok') {
        return { ...state, phase: 'done', result: outcome.summary, error: null, canceling: false };
      }
      if (outcome.status === 'canceled') {
        return { ...state, phase: 'canceled', error: null, canceling: false };
      }
      return { ...state, phase: 'error', error: outcome.error, canceling: false };
    }
  }
}
