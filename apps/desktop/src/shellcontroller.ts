import path from 'node:path';

import type { LatLon } from 'drone-path-core/geo';
import {
  parseExportRequest,
  parseSettingsPatch,
} from 'drone-path-engine/config';
import type { ExportRequest, RenderConfig } from 'drone-path-engine/config';
import { outputPathFor } from 'drone-path-engine/pipeline';
import { isRecordingName, videoBaseName } from 'drone-path-engine/recordings';

import { codedDesktopError } from 'drone-path-desktop/shared/errors';
import type { StructuredError } from 'drone-path-desktop/shared/errors';
import { IPC_EVENT_CHANNELS } from 'drone-path-desktop/shared/ipc';
import type {
  ArchiveNearHit,
  ArchiveQueryFilters,
  ArchiveQueryResult,
  IpcAck,
} from 'drone-path-desktop/shared/ipc';
import type { ArchiveService } from './archiveservice.js';
import type { AppSession, PickResult, UiSession } from './appsession.js';
import {
  parseOpenArchiveClipRequest,
  parsePickRequest,
  parseTrackSaveRequest,
} from './appsession.js';
import {
  addArchiveRoot,
  applyAppState,
  emptyAppState,
  rememberOpenedFile,
  removeArchiveRoot,
} from './appstate.js';
import type { AppState } from './appstate.js';
import { createCloseGuard } from './closeguard.js';
import type { CloseGuard } from './closeguard.js';
import { isLocale, resolveLocale, translator } from '#shared/desktop-i18n/messages.js';
import type { LanguageSettings, Locale, Translate } from '#shared/desktop-i18n/messages.js';
import type { ExportOutcome } from './exportjob.js';
import { createOutputGuard } from './outputguard.js';

export interface ShellWindow {
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

export interface ExportRunnerPort {
  start(videoPath: string, request: ExportRequest): void;
  cancel(): void;
  running(): boolean;
}

export interface UpdateController {
  restart(deps: { onError: (failure: StructuredError) => void }): IpcAck;
}

export interface InitUpdatesOptions {
  log: (message: string) => void;
  onReady: () => void;
}

export interface AppStateStore {
  read(): AppState;
  write(state: AppState): void;
  saveSafely(state: AppState): void;
}

export interface ShellControllerOptions {
  config: RenderConfig;
  appState?: AppState;
  stateStore: AppStateStore;
  systemLanguages: readonly string[];
  dirExists: (dirPath: string) => boolean;
  confirmStopExport: (win: ShellWindow | null, t: Translate) => Promise<boolean>;
  quitApp: () => void;
  log: (message: string) => void;
}

export interface IpcController {
  pickRecording(raw: unknown): Promise<PickResult>;
  getSession(): UiSession | null;
  getSettings(): RenderConfig;
  saveSettings(raw: unknown): void;
  getLanguage(): LanguageSettings;
  saveLanguage(preference: unknown): LanguageSettings;
  beginExportPick(): { defaultPath: string; t: Translate };
  approveExportOut(outPath: string): void;
  startExport(raw: unknown): void;
  cancelExport(): void;
  beginTrackPick(): { defaultPath: string; t: Translate };
  approveTrackOut(outPath: string): void;
  saveTrack(raw: unknown): string;
  resolveKnownOutput(payload: unknown): string;
  getUpdateState(): { ready: boolean };
  restartUpdate(): IpcAck;
  closeWindow(): void;
  listArchiveRoots(): string[];
  addArchiveRoot(dir: string): { root: string; roots: string[] };
  removeArchiveRoot(dir: unknown): string[];
  scanArchive(roots?: unknown): Promise<{ scanned: number }>;
  cancelArchiveScan(): void;
  queryArchive(filters?: unknown): ArchiveQueryResult;
  findArchiveAtPoint(point: unknown, radiusM?: unknown, includeGaze?: unknown): ArchiveNearHit[];
  openArchiveClip(raw: unknown): Promise<PickResult>;
  liveWindow(): ShellWindow | null;
  translator(): Translate;
}

export interface ShellController {
  ipc: IpcController;
  closeGuard: CloseGuard;
  setWindow(win: ShellWindow | null): void;
  liveWindow(): ShellWindow | null;
  attachSession(session: AppSession | null): void;
  attachArchiveService(service: ArchiveService | null): void;
  getArchiveRoots(): string[];
  addArchiveRootState(dir: string): string[];
  removeArchiveRootState(dir: string): string[];
  videoPath(): string | null;
  attachExportRunner(runner: ExportRunnerPort | null): void;
  attachUpdates(updates: UpdateController | null): void;
  markUpdateReady(): void;
  rememberPickedFile(filePath: string): void;
  rememberedOpenDir(): string | undefined;
  locale(): Locale;
  translator(): Translate;
  sendToWindow(channel: string, payload?: unknown): void;
  handleExportDone(outcome: ExportOutcome): void;
  getConfig(): RenderConfig;
}

/** Owns desktop shell state transitions, persistence policies, and narrow IPC/close-guard ports. */
export function createShellController(options: ShellControllerOptions): ShellController {
  let win: ShellWindow | null = null;
  let session: AppSession | null = null;
  let archiveService: ArchiveService | null = null;
  let exportRunner: ExportRunnerPort | null = null;
  let updates: UpdateController | null = null;
  let updateReady = false;
  let appState: AppState = options.appState ?? emptyAppState();
  let config: RenderConfig = applyAppState(options.config, appState);
  const outputs = createOutputGuard();

  function requireArchiveService(): ArchiveService {
    if (!archiveService) throw new Error('archive service not initialized');
    return archiveService;
  }

  function liveWindow(): ShellWindow | null {
    return win && !win.isDestroyed() ? win : null;
  }

  function currentLocale(): Locale {
    return resolveLocale(appState.language, options.systemLanguages);
  }

  function currentTranslator(): Translate {
    return translator(currentLocale());
  }

  function sendToWindow(channel: string, payload?: unknown): void {
    liveWindow()?.webContents.send(channel, payload);
  }

  function requireVideo(): string {
    const video = session ? session.videoPath() : null;
    if (!video) throw codedDesktopError('NO_RECORDING', 'no recording loaded');
    return video;
  }

  function exportDefaultFor(video: string): string {
    const outDir = config.outDir
      ? path.resolve(path.dirname(video), config.outDir)
      : null;
    return outputPathFor(video, { ...config, outDir });
  }

  function languageSettings(): LanguageSettings {
    const preference = isLocale(appState.language) ? appState.language : null;
    return { preference, locale: resolveLocale(preference, options.systemLanguages) };
  }

  const closeGuard = createCloseGuard({
    isExportRunning: () => Boolean(exportRunner?.running()),
    cancelExport: () => exportRunner?.cancel(),
    confirmStopExport: () => options.confirmStopExport(liveWindow(), currentTranslator()),
    closeWindow: () => {
      const target = liveWindow();
      if (!target) return false;
      target.close();
      return true;
    },
    quitApp: options.quitApp,
    log: options.log,
  });

  function handleExportDone(outcome: ExportOutcome): void {
    if (outcome.status === 'ok') outputs.recordExportOut(outcome.summary.out);
    closeGuard.onExportSettled(outcome, (result) =>
      sendToWindow(IPC_EVENT_CHANNELS.onExportDone, result),
    );
  }

  const ipc: IpcController = {
    async pickRecording(raw: unknown): Promise<PickResult> {
      if (!session) throw new Error('session not initialized');
      const result = await session.pick(parsePickRequest(raw));
      if (result.ok) outputs.clearPending();
      return result;
    },
    getSession: () => session?.getSession() ?? null,
    getSettings: () => config,
    saveSettings(raw: unknown): void {
      const settings = parseSettingsPatch(raw, 'settings');
      appState = { ...appState, settings };
      config = applyAppState(config, appState);
      // The look still applies when the state file cannot be written.
      options.stateStore.saveSafely(appState);
    },
    getLanguage: () => languageSettings(),
    saveLanguage(preference: unknown): LanguageSettings {
      if (preference !== null && !isLocale(preference)) {
        throw codedDesktopError('INVALID_LANGUAGE', 'invalid app language');
      }
      const nextState: AppState = { ...appState, language: preference };
      // Language save writes strictly first so a write failure keeps the previous preference.
      options.stateStore.write(nextState);
      appState = nextState;
      return languageSettings();
    },
    beginExportPick(): { defaultPath: string; t: Translate } {
      outputs.clearPendingExport();
      const video = requireVideo();
      return { defaultPath: exportDefaultFor(video), t: currentTranslator() };
    },
    approveExportOut(outPath: string): void {
      outputs.approveExport(outPath);
    },
    startExport(raw: unknown): void {
      if (!exportRunner) throw new Error('export runner not initialized');
      const video = requireVideo();
      const request = parseExportRequest(raw, config);
      const approved = outputs.consumeExport(request.outPath);
      exportRunner.start(video, { ...request, outPath: approved });
    },
    cancelExport(): void {
      if (!exportRunner) throw new Error('export runner not initialized');
      exportRunner.cancel();
    },
    beginTrackPick(): { defaultPath: string; t: Translate } {
      outputs.clearPendingTrack();
      const video = requireVideo();
      // The export dialog's default folder, named after the recording
      // (<basename>.telemetry.json); the typed name selects the format by its
      // extension, with the telemetry document as the bare-name default.
      const exportDefault = exportDefaultFor(video);
      return {
        defaultPath: path.join(path.dirname(exportDefault), `${videoBaseName(video)}.telemetry.json`),
        t: currentTranslator(),
      };
    },
    approveTrackOut(outPath: string): void {
      outputs.approveTrack(outPath);
    },
    saveTrack(raw: unknown): string {
      if (!session) throw new Error('session not initialized');
      requireVideo();
      const request = parseTrackSaveRequest(raw);
      const approved = outputs.consumeTrack(request.outPath);
      session.saveTrack(approved, request.range);
      outputs.recordTrackOut(approved);
      return approved;
    },
    resolveKnownOutput: (payload: unknown): string => outputs.knownOutputOf(payload),
    getUpdateState: () => ({ ready: updateReady }),
    restartUpdate(): IpcAck {
      if (!updates) {
        return {
          ok: false,
          code: 'UPDATES_UNAVAILABLE',
          detail: 'this build does not self-update',
        };
      }
      // No pendingClose here: the prompt never opens over a running export, and
      // a failed restart must not poison the export close guard.
      return updates.restart({
        onError: (failure) => sendToWindow(IPC_EVENT_CHANNELS.onUpdateRestartFailed, failure),
      });
    },
    closeWindow(): void {
      liveWindow()?.close();
    },
    listArchiveRoots(): string[] {
      return archiveService ? archiveService.listRoots() : [...appState.archiveRoots];
    },
    addArchiveRoot(dir: string): { root: string; roots: string[] } {
      const resolved = path.resolve(dir);
      const roots = requireArchiveService().addRoot(resolved);
      return { root: resolved, roots };
    },
    removeArchiveRoot(dir: unknown): string[] {
      return requireArchiveService().removeRoot(dir as string);
    },
    scanArchive(roots?: unknown): Promise<{ scanned: number }> {
      return requireArchiveService().scan(roots as string[] | undefined);
    },
    cancelArchiveScan(): void {
      archiveService?.cancelScan();
    },
    queryArchive(filters?: unknown): ArchiveQueryResult {
      return requireArchiveService().query(filters as ArchiveQueryFilters | undefined);
    },
    findArchiveAtPoint(
      point: unknown,
      radiusM?: unknown,
      includeGaze?: unknown,
    ): ArchiveNearHit[] {
      return requireArchiveService().findAtPoint(
        point as LatLon,
        radiusM as number | undefined,
        includeGaze as boolean | undefined,
      );
    },
    async openArchiveClip(raw: unknown): Promise<PickResult> {
      if (!session) throw new Error('session not initialized');
      const request = parseOpenArchiveClipRequest(raw);
      const resolved = path.resolve(request.path);
      if (isRecordingName(resolved) && archiveService && !archiveService.fileExists(resolved)) {
        return {
          ok: false,
          code: 'ARCHIVE_CLIP_OFFLINE',
          detail: `recording is offline or missing: ${resolved}`,
          params: { name: path.basename(resolved) },
        };
      }
      const result = await session.openFile(resolved, { settings: request.settings });
      if (result.ok) outputs.clearPending();
      return result;
    },
    liveWindow,
    translator: currentTranslator,
  };

  return {
    ipc,
    closeGuard,
    setWindow(nextWin: ShellWindow | null): void {
      win = nextWin;
    },
    liveWindow,
    attachSession(nextSession: AppSession | null): void {
      session = nextSession;
    },
    attachArchiveService(nextService: ArchiveService | null): void {
      archiveService = nextService;
    },
    getArchiveRoots: () => [...appState.archiveRoots],
    addArchiveRootState(dir: string): string[] {
      const next = addArchiveRoot(appState, dir);
      options.stateStore.write(next);
      appState = next;
      return [...appState.archiveRoots];
    },
    removeArchiveRootState(dir: string): string[] {
      const next = removeArchiveRoot(appState, dir);
      options.stateStore.write(next);
      appState = next;
      return [...appState.archiveRoots];
    },
    videoPath: () => session?.videoPath() ?? null,
    attachExportRunner(runner: ExportRunnerPort | null): void {
      exportRunner = runner;
    },
    attachUpdates(nextUpdates: UpdateController | null): void {
      updates = nextUpdates;
    },
    markUpdateReady(): void {
      updateReady = true;
    },
    rememberPickedFile(filePath: string): void {
      appState = rememberOpenedFile(appState, filePath);
      options.stateStore.saveSafely(appState);
    },
    rememberedOpenDir(): string | undefined {
      const dir = appState.lastOpenDir;
      return dir && options.dirExists(dir) ? dir : undefined;
    },
    locale: currentLocale,
    translator: currentTranslator,
    sendToWindow,
    handleExportDone,
    getConfig: () => config,
  };
}
