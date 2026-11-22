import type { RenderConfig } from 'drone-path-engine/config';
import type { ExportOutcome } from '../src/exportjob.js';

export interface MainWindow {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): void;
  isDestroyed(): boolean;
  close(): void;
  webContents: {
    send(channel: string, payload?: unknown): void;
  };
}

export interface NavigationWebContents {
  on(
    event: 'will-navigate' | 'will-redirect',
    listener: (event: { preventDefault(): void }, url: string) => void,
  ): void;
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
  pendingExportOut: string | null;
  pendingTrackOut: string | null;
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
export function resolveDesktopConfig(userDir?: string): { config: RenderConfig; configPath: string | null };
export function installNavigationGuards(webContents: NavigationWebContents, devUrl: string | null): void;
export function handleExportDone(state: ShellState, outcome: ExportOutcome): void;
export function installCloseGuard(state: ShellState): void;
export function handleWindowAllClosed(state: ShellState): void;
export function installSecurityHeaders(
  targetSession: HeaderSession,
  csp: string,
  devUrl?: string | null,
): void;
