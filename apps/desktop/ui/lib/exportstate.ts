import { tEnglish } from '../../shared/desktop-i18n/loader.js';
import type { Translate } from '../../shared/desktop-i18n/loader.js';
import type { ExportRequest } from 'drone-path-engine/config';
import { normalizeDimensions } from 'drone-path-engine/config';
import type { FrameRange } from 'drone-path-core/frame-range';
import type { ExportOutcome } from '../../shared/contracts.js';
import type { CaptureProgress } from 'drone-path-engine/render';
import type { RecordingSummary } from 'drone-path-engine/pipeline';

type ExportPhase = 'form' | 'running' | 'done';

export function captureFraction(capture: CaptureProgress | null): number | null {
  if (!capture) return null;
  return capture.total > 0 ? Math.min(1, capture.done / capture.total) : null;
}

export function captureQuartile(fraction: number | null): number | null {
  if (fraction === null) return null;
  const percent = Math.round(fraction * 100);
  return (Math.floor(percent / 25) * 25) / 100;
}

export function runningPhaseText(fraction: number | null, canceling: boolean, t: Translate = tEnglish): string {
  if (canceling) return t('exportstate.canceling');
  return fraction === null ? t('exportstate.preparing') : t('exportstate.exporting', { percent: Math.round(fraction * 100) });
}

// The visible phase line carries continuous running progress and the success
// sentence; the form and its outcome notices announce themselves, so the
// form leaves it empty.
export function exportPhaseText(state: ExportState, t: Translate = tEnglish): string {
  switch (state.phase) {
    case 'form':
      return '';
    case 'running':
      return runningPhaseText(captureFraction(state.capture), state.canceling, t);
    case 'done':
      return t('exportstate.finished');
  }
}

// The persistent role="status" line throttles running capture progress to
// 25% quartiles so screen readers are not flooded on every 1% tick while
// ProgressBar already exposes continuous progress.
export function exportStatusText(state: ExportState, t: Translate = tEnglish): string {
  switch (state.phase) {
    case 'form':
      return '';
    case 'running':
      return runningPhaseText(captureQuartile(captureFraction(state.capture)), state.canceling, t);
    case 'done':
      return t('exportstate.finished');
  }
}

export function previewFrame(range: FrameRange | null, frames: number): number {
  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, frames - 1);
  return Math.max(0, Math.min(Math.max(0, frames - 1), Math.round((start + end) / 2)));
}

export interface ExportForm {
  width: number;
  height: number;
  range: FrameRange | null;
}

export interface ExportState {
  phase: ExportPhase;
  form: ExportForm;
  request: ExportRequest | null;
  capture: CaptureProgress | null;
  result: RecordingSummary | null;
  error: string | null;
  // The outcome sentence of a canceled run, shown by the form as an info
  // notice; a failure's sentence travels in `error` instead (#282).
  notice: 'canceled' | null;
  canceling: boolean;
}

export type ExportEvent =
  | { type: 'setWidth'; width: number }
  | { type: 'setHeight'; height: number }
  | { type: 'setRange'; range: FrameRange | null }
  | { type: 'failed'; error: string }
  | { type: 'start'; request: ExportRequest }
  | { type: 'startFailed'; error: string }
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
    form: { ...normalizeDimensions(width, height), range },
    request: null,
    capture: null,
    result: null,
    error: null,
    notice: null,
    canceling: false,
  };
}

export function exportReducer(state: ExportState, event: ExportEvent): ExportState {
  switch (event.type) {
    case 'setWidth':
      return state.phase === 'form'
        ? {
            ...state,
            form: { ...state.form, ...normalizeDimensions(event.width, state.form.height) },
            error: null,
            notice: null,
          }
        : state;
    case 'setHeight':
      return state.phase === 'form'
        ? {
            ...state,
            form: { ...state.form, ...normalizeDimensions(state.form.width, event.height) },
            error: null,
            notice: null,
          }
        : state;
    case 'setRange':
      return state.phase === 'form'
        ? { ...state, form: { ...state.form, range: event.range }, error: null, notice: null }
        : state;
    case 'failed':
      return { ...state, error: event.error, notice: null };
    case 'start':
      return state.phase === 'form'
        ? {
            ...state,
            phase: 'running',
            request: event.request,
            capture: null,
            result: null,
            error: null,
            notice: null,
            canceling: false,
          }
        : state;
    case 'startFailed':
      return state.phase === 'running'
        ? { ...state, phase: 'form', request: null, error: event.error, notice: null }
        : state;
    case 'capture':
      return state.phase === 'running'
        ? { ...state, capture: event.progress }
        : state;
    case 'cancelRequested':
      return state.phase === 'running'
        ? { ...state, canceling: true, error: null, notice: null }
        : state;
    case 'cancelFailed':
      return state.phase === 'running'
        ? { ...state, canceling: false, error: event.error, notice: null }
        : state;
    case 'clearError':
      return { ...state, error: null, notice: null };
    case 'finish': {
      if (state.phase !== 'running') return state;
      const { outcome } = event;
      if (outcome.status === 'ok') {
        return {
          ...state,
          phase: 'done',
          result: outcome.summary,
          error: null,
          notice: null,
          canceling: false,
        };
      }
      // Failed and canceled runs return to the form carrying their sentence,
      // matching the start-failure behavior (#282).
      if (outcome.status === 'canceled') {
        return {
          ...state,
          phase: 'form',
          request: null,
          error: null,
          notice: 'canceled',
          canceling: false,
        };
      }
      return {
        ...state,
        phase: 'form',
        request: null,
        error: outcome.error,
        notice: null,
        canceling: false,
      };
    }
  }
}
