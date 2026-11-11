import type {
  IpcResult,
  PickRequest,
  PickResult,
  TelemetrySaveRequest,
  UiSession,
} from '../../src/appsession.js';
import type { ExportRequest, RenderConfig, SettingsPatch } from '../../src/config.js';
import type { ExportOutcome } from '../../src/exportjob.js';
import type { CaptureProgress } from '../../src/render.js';
import type { PrepareProgress } from '../../src/run.js';

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

export interface AppBridge {
  pickRecording(request: PickRequest): Promise<PickResult>;
  getSession(): Promise<UiSession | null>;
  getSettings(): Promise<RenderConfig>;
  saveSettings(patch: SettingsPatch): Promise<ExportAck>;
  pickExportOutput(): Promise<PickOutputResult>;
  pickTelemetryOutput(): Promise<PickOutputResult>;
  saveTelemetryJson(request: TelemetrySaveRequest): Promise<ExportAck>;
  startExport(request: ExportRequest): Promise<ExportAck>;
  cancelExport(): Promise<ExportAck>;
  revealExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
  openExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
  onExportProgress(cb: (message: string) => void): () => void;
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

export function appBridge(): AppBridge {
  const bridge = window.dronepath;
  if (!bridge) throw new Error('app bridge unavailable');
  return bridge;
}
