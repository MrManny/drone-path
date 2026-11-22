import type { ExportOutcome } from '../src/exportjob.js';

export interface MainWindow {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): void;
  isDestroyed(): boolean;
  close(): void;
  webContents: {
    send(channel: string, payload?: unknown): void;
  };
}

export interface ShellState {
  win: MainWindow | null;
  session: unknown;
  config: unknown;
  appState: { language: string | null; lastOpenDir?: string | null; [key: string]: unknown };
  systemLanguages: string[];
  tileTraffic: unknown;
  tilePrefetch: unknown;
  exportRunner: {
    cancel(): void;
    running(): boolean;
  } | null;
  updates: unknown;
  updateReady: boolean;
  lastExportOut: string | null;
  lastTrackOut: string | null;
  closePromptOpen: boolean;
  pendingClose: boolean;
}

export interface HeaderSession {
  webRequest: {
    onHeadersReceived(
      listener: (
        details: { url: string; responseHeaders?: Record<string, string[]> },
        callback: (response: { responseHeaders?: Record<string, string[]> }) => void,
      ) => void,
    ): void;
  };
}

export function createShellState(): ShellState;
export function handleExportDone(state: ShellState, outcome: ExportOutcome): void;
export function installCloseGuard(state: ShellState): void;
export function handleWindowAllClosed(state: ShellState): void;
export function installSecurityHeaders(
  targetSession: HeaderSession,
  csp: string,
  devUrl?: string | null,
): void;
