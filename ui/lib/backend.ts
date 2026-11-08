// The renderer's view of the app backend. In Electron this is the preload
// bridge (contextBridge + validated IPC); without it the UI cannot drive the
// native dialog or the pipeline.

import type { PickRequest, PickResult, UiSession } from '../../src/appsession.js';
import type { ExportRequest, RenderConfig, SettingsPatch } from '../../src/config.js';
import type { ExportOutcome } from '../../src/exportjob.js';
import type { CaptureProgress } from '../../src/render.js';
import type { PrepareProgress } from '../../src/run.js';

interface PickOutputResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export interface ExportAck {
  ok: boolean;
  error?: string;
}

/** The done-phase actions name the one file the shell may reveal or open. */
export interface ExportOutputPayload {
  out: string;
}

/** A downloaded update waits even when its event preceded the subscription. */
interface UpdateState {
  ready: boolean;
}

export interface AppBridge {
  pickRecording(request: PickRequest): Promise<PickResult>;
  getSession(): Promise<UiSession | null>;
  getSettings(): Promise<RenderConfig>;
  /** Persist the panel's look so the next launch restores it. */
  saveSettings(patch: SettingsPatch): Promise<ExportAck>;
  pickExportOutput(): Promise<PickOutputResult>;
  startExport(request: ExportRequest): Promise<ExportAck>;
  cancelExport(): Promise<ExportAck>;
  revealExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
  openExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
  onExportProgress(cb: (message: string) => void): () => void;
  /** Typed capture progress, so the export bar needs no log scraping. */
  onExportCapture(cb: (progress: CaptureProgress) => void): () => void;
  onExportDone(cb: (outcome: ExportOutcome) => void): () => void;
  /** The picked recording passed its checks and is being prepared (the picker has closed). */
  onPreparing(cb: () => void): () => void;
  /** The preparation's loading steps, so the busy status can show its progress. */
  onPrepareProgress(cb: (progress: PrepareProgress) => void): () => void;
  /** A newer version finished downloading in the background. */
  onUpdateReady(cb: () => void): () => void;
  /** The restart could not start; the prompt may offer it again. */
  onUpdateRestartFailed(cb: (message: string) => void): () => void;
  /** The catch-up query for downloads that finished before the subscription. */
  getUpdateState(): Promise<UpdateState>;
  /** Restart the app into the downloaded update; the shell installs it. */
  restartToUpdate(): Promise<ExportAck>;
}

declare global {
  interface Window {
    dronepath?: AppBridge;
  }
}

export function appBridge(): AppBridge {
  const bridge = window.dronepath;
  if (!bridge) throw new Error('app bridge unavailable');
  return bridge;
}
