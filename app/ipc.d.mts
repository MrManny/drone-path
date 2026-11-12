import type { AppSession } from '../src/appsession.js';
import type { AppState } from '../src/appstate.js';
import type { ExportRequest, RenderConfig } from '../src/config.js';
import type { UpdateController } from './update.mjs';

export interface IpcWindow {
  isDestroyed(): boolean;
  close(): void;
}

export interface IpcState {
  session: AppSession | null;
  config: RenderConfig;
  appState: AppState;
  win: IpcWindow | null;
  exportRunner: {
    start(videoPath: string, request: ExportRequest): void;
    cancel(): void;
  };
  updates: UpdateController | null;
  updateReady: boolean;
  lastExportOut: string | null;
  lastTelemetryOut: string | null;
}

export interface IpcHandlersOptions {
  devUrl: string | null;
  log: (message: string) => void;
  sendToWindow(state: IpcState, channel: string, payload: unknown): void;
}

export function registerIpcHandlers(state: IpcState, options: IpcHandlersOptions): void;
