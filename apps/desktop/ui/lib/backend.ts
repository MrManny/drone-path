import type {
  IpcResult,
  PickRequest,
  PickResult,
  TrackSaveRequest,
  UiSession,
} from '../../src/appsession.js';
import type { ExportRequest, RenderConfig, SettingsPatch } from 'drone-path-engine/config';
import { ERR_APP_BRIDGE_UNAVAILABLE } from 'drone-path-core/errors';
import type { LanguageSettings, Locale } from '../../src/desktop-i18n/messages.js';
import type { ExportOutcome } from '../../src/exportjob.js';
import type { CaptureProgress } from 'drone-path-engine/render';
import type { PrepareProgress } from 'drone-path-engine/pipeline';

export interface PickOutputResult extends IpcResult {
  path?: string;
}

export type ExportAck = IpcResult;

export interface ExportOutputPayload {
  out: string;
}

interface UpdateState {
  ready: boolean;
}

interface AppBridge {
  pickRecording(request: PickRequest): Promise<PickResult>;
  getSession(): Promise<UiSession | null>;
  getSettings(): Promise<RenderConfig>;
  getLanguage(): Promise<LanguageSettings>;
  saveLanguage(preference: Locale | null): Promise<(LanguageSettings & { ok: true }) | { ok: false; error?: string }>;
  saveSettings(patch: SettingsPatch): Promise<ExportAck>;
  pickExportOutput(): Promise<PickOutputResult>;
  pickTrackOutput(): Promise<PickOutputResult>;
  saveTrack(request: TrackSaveRequest): Promise<ExportAck>;
  startExport(request: ExportRequest): Promise<ExportAck>;
  cancelExport(): Promise<ExportAck>;
  revealExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
  openExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
  onExportCapture(cb: (progress: CaptureProgress) => void): () => void;
  onExportDone(cb: (outcome: ExportOutcome) => void): () => void;
  onPreparing(cb: () => void): () => void;
  onPrepareProgress(cb: (progress: PrepareProgress) => void): () => void;
  onUpdateReady(cb: () => void): () => void;
  onUpdateRestartFailed(cb: (message: string) => void): () => void;
  getUpdateState(): Promise<UpdateState>;
  restartToUpdate(): Promise<ExportAck>;
  closeWindow(): Promise<void>;
}

declare global {
  interface Window {
    dronepath?: AppBridge;
  }
}

export function tryAppBridge(): AppBridge | null {
  return window.dronepath ?? null;
}

export function appBridge(): AppBridge {
  const bridge = tryAppBridge();
  if (!bridge) throw new Error(ERR_APP_BRIDGE_UNAVAILABLE);
  return bridge;
}
