import type { FrameRange } from 'drone-path-core/frame-range';
import type { Bbox, LatLon } from 'drone-path-core/geo';
import type { ShotType } from 'drone-path-core/shot-segmentation';
import type { AppearanceSettings, ExportRequest, RenderConfig, SettingsPatch } from 'drone-path-engine/config';
import type { PrepareProgress, RecordingSummary } from 'drone-path-engine/pipeline';
import type { CaptureProgress } from 'drone-path-engine/render';
import type { SceneData } from 'drone-path-engine/renderer/scene';
import type { StructuredError } from './errors.js';

export const IPC_INVOKE_CHANNELS = {
  pickRecording: 'dronepath:pick',
  getSession: 'dronepath:session',
  getLanguage: 'dronepath:language',
  saveLanguage: 'dronepath:language:save',
  getSettings: 'dronepath:settings',
  saveSettings: 'dronepath:settings:save',
  pickExportOutput: 'dronepath:export:pick-output',
  pickTrackOutput: 'dronepath:track:pick-output',
  saveTrack: 'dronepath:track:save',
  startExport: 'dronepath:export:start',
  cancelExport: 'dronepath:export:cancel',
  revealExportOutput: 'dronepath:export:reveal',
  openExportOutput: 'dronepath:export:open',
  getUpdateState: 'dronepath:update:state',
  restartToUpdate: 'dronepath:update:restart',
  closeWindow: 'dronepath:window:close',
  pickArchiveFolder: 'dronepath:archive:pick-folder',
  listArchiveRoots: 'dronepath:archive:roots',
  removeArchiveRoot: 'dronepath:archive:remove-root',
  scanArchive: 'dronepath:archive:scan',
  cancelArchiveScan: 'dronepath:archive:cancel-scan',
  queryArchive: 'dronepath:archive:query',
  findArchiveAtPoint: 'dronepath:archive:find-at-point',
  openArchiveClip: 'dronepath:archive:open-clip',
  revealArchiveClip: 'dronepath:archive:reveal-clip',
  pickArchiveExportOutput: 'dronepath:archive:pick-export-output',
  exportArchive: 'dronepath:archive:export',
  pruneArchiveOffline: 'dronepath:archive:prune-offline',
} as const;

export const IPC_EVENT_CHANNELS = {
  onExportCapture: 'dronepath:export:capture',
  onExportDone: 'dronepath:export:done',
  onPreparing: 'dronepath:preparing',
  onPrepareProgress: 'dronepath:preparing:progress',
  onUpdateReady: 'dronepath:update:ready',
  onUpdateRestartFailed: 'dronepath:update:restart-failed',
  onArchiveScanProgress: 'dronepath:archive:scan-progress',
} as const;

export type InvokeMethodName = keyof typeof IPC_INVOKE_CHANNELS;
export type EventMethodName = keyof typeof IPC_EVENT_CHANNELS;
export type IpcInvokeChannel = (typeof IPC_INVOKE_CHANNELS)[InvokeMethodName];
export type IpcEventChannel = (typeof IPC_EVENT_CHANNELS)[EventMethodName];

// Void push events carry no payload to renderer callbacks.
export const IPC_VOID_EVENT_KEYS: ReadonlySet<EventMethodName> = new Set<EventMethodName>([
  'onPreparing',
  'onUpdateReady',
]);

export interface PageVideo {
  src: string;
  fps: number;
  frames: number;
  width: number;
  height: number;
}

export interface UiSession {
  scene: SceneData;
  video: PageVideo;
  tileBase: string;
  bbox: Bbox;
  durationSec: number;
}

export interface PickRequest {
  settings: AppearanceSettings;
}

export interface TrackSaveRequest {
  outPath: string;
  range: FrameRange | null;
}

export type IpcFailure = { ok: false; canceled?: false } & StructuredError;
export interface IpcCanceled {
  ok: false;
  canceled: true;
}

export type IpcAck = { ok: true } | IpcFailure;
export type PickResult = { ok: true } | IpcCanceled | IpcFailure;
export type PickOutputResult = { ok: true; path: string } | IpcCanceled | IpcFailure;

export interface ExportOutputPayload {
  out: string;
}

export interface UpdateState {
  ready: boolean;
}

export interface LanguageSettings<TLocale extends string = string> {
  preference: string | null;
  locale: TLocale;
}

export type SaveLanguageResult<TLocale extends string = string> =
  | (LanguageSettings<TLocale> & { ok: true })
  | IpcFailure;

export type ExportOutcome =
  | { status: 'ok'; summary: RecordingSummary }
  | ({ status: 'error' } & StructuredError)
  | { status: 'canceled' };

export type ArchiveAvailability = 'online' | 'offline';
export type ArchiveScanStatus = 'ok' | 'no-telemetry' | 'no-gps' | 'error';

export interface ArchiveTrackPoint {
  lat: number;
  lon: number;
  tSec: number;
}

export interface ArchiveClipDto {
  path: string;
  size: number | null;
  mtimeMs: number | null;
  status: ArchiveScanStatus;
  availability: ArchiveAvailability;
  posterId?: string;
  video: {
    fps: { num: number; den: number; value: number; str: string };
    frames: number;
    width: number;
    height: number;
    durationSec: number | null;
  } | null;
  cameraCreationTime: string | null;
  telemetry: {
    source: string;
    method: string;
    fixCount: number;
    noLock: number;
    trackDistanceM: number;
  } | null;
  bbox: Bbox | null;
  track: ArchiveTrackPoint[][];
  error: string | null;
}

export interface ArchiveFlightClipDto extends ArchiveClipDto {
  splitFromKey: string | null;
}

export interface ArchiveFlightDto {
  flightId: string;
  clips: ArchiveFlightClipDto[];
}

export interface ArchiveQueryFilters {
  bbox?: Bbox;
  afterMs?: number;
  beforeMs?: number;
  minDistanceM?: number;
  availability?: ArchiveAvailability;
  segmentType?: ShotType;
  minSmoothness?: number;
  folderRoot?: string;
  flightId?: string;
}

export const ARCHIVE_EXPORT_FORMATS = ['gpx', 'geojson', 'kml', 'kmz', 'html'] as const;
export type ArchiveExportFormat = (typeof ARCHIVE_EXPORT_FORMATS)[number];

export interface ArchiveExportRequest {
  outPath: string;
  format: ArchiveExportFormat;
  filters?: ArchiveQueryFilters;
  redactLaunchM?: number;
  includeGaze?: boolean;
  offline?: boolean;
}

export interface ArchiveQueryResult {
  flights: ArchiveFlightDto[];
  totalCount: number;
  offlineCount: number;
  offlineRoots?: string[];
}

export interface ArchiveNearHit {
  clip: ArchiveClipDto;
  tSec: number;
  distanceM: number;
  matchType: 'track' | 'gaze';
}

export interface ArchiveScanProgress {
  phase: 'scanning' | 'done' | 'canceled' | 'error';
  scanned: number;
  total?: number;
  currentPath?: string;
  status: 'running' | 'done' | 'canceled' | 'error';
}

export interface OpenArchiveClipRequest {
  path: string;
  settings: AppearanceSettings;
  seekSec?: number;
}

export type ArchivePickFolderResult =
  | { ok: true; root: string; roots: string[] }
  | IpcCanceled
  | IpcFailure;

export type ArchiveRemoveRootResult = { ok: true; roots: string[] } | IpcFailure;
export type ArchiveScanResult = { ok: true; scanned: number } | IpcFailure;
export type ArchivePruneOfflineResult = { ok: true; removed: number } | IpcFailure;

export interface IpcInvokeMap<TLocale extends string = string> {
  [IPC_INVOKE_CHANNELS.pickRecording]: {
    args: [request: PickRequest];
    result: PickResult;
  };
  [IPC_INVOKE_CHANNELS.getSession]: {
    args: [];
    result: UiSession | null;
  };
  [IPC_INVOKE_CHANNELS.getLanguage]: {
    args: [];
    result: LanguageSettings<TLocale>;
  };
  [IPC_INVOKE_CHANNELS.saveLanguage]: {
    args: [preference: TLocale | null];
    result: SaveLanguageResult<TLocale>;
  };
  [IPC_INVOKE_CHANNELS.getSettings]: {
    args: [];
    result: RenderConfig;
  };
  [IPC_INVOKE_CHANNELS.saveSettings]: {
    args: [patch: SettingsPatch];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.pickExportOutput]: {
    args: [];
    result: PickOutputResult;
  };
  [IPC_INVOKE_CHANNELS.pickTrackOutput]: {
    args: [];
    result: PickOutputResult;
  };
  [IPC_INVOKE_CHANNELS.saveTrack]: {
    args: [request: TrackSaveRequest];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.startExport]: {
    args: [request: ExportRequest];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.cancelExport]: {
    args: [];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.revealExportOutput]: {
    args: [payload: ExportOutputPayload];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.openExportOutput]: {
    args: [payload: ExportOutputPayload];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.getUpdateState]: {
    args: [];
    result: UpdateState;
  };
  [IPC_INVOKE_CHANNELS.restartToUpdate]: {
    args: [];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.closeWindow]: {
    args: [];
    result: void;
  };
  [IPC_INVOKE_CHANNELS.pickArchiveFolder]: {
    args: [];
    result: ArchivePickFolderResult;
  };
  [IPC_INVOKE_CHANNELS.listArchiveRoots]: {
    args: [];
    result: string[];
  };
  [IPC_INVOKE_CHANNELS.removeArchiveRoot]: {
    args: [dir: string];
    result: ArchiveRemoveRootResult;
  };
  [IPC_INVOKE_CHANNELS.scanArchive]: {
    args: [roots?: string[]];
    result: ArchiveScanResult;
  };
  [IPC_INVOKE_CHANNELS.cancelArchiveScan]: {
    args: [];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.queryArchive]: {
    args: [filters?: ArchiveQueryFilters];
    result: ArchiveQueryResult;
  };
  [IPC_INVOKE_CHANNELS.findArchiveAtPoint]: {
    args: [point: LatLon, radiusM?: number, includeGaze?: boolean];
    result: ArchiveNearHit[];
  };
  [IPC_INVOKE_CHANNELS.openArchiveClip]: {
    args: [request: OpenArchiveClipRequest];
    result: PickResult;
  };
  [IPC_INVOKE_CHANNELS.revealArchiveClip]: {
    args: [clipPath: string];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.pickArchiveExportOutput]: {
    args: [format?: ArchiveExportFormat];
    result: PickOutputResult;
  };
  [IPC_INVOKE_CHANNELS.exportArchive]: {
    args: [request: ArchiveExportRequest];
    result: IpcAck;
  };
  [IPC_INVOKE_CHANNELS.pruneArchiveOffline]: {
    args: [];
    result: ArchivePruneOfflineResult;
  };
}

export interface IpcEventMap {
  [IPC_EVENT_CHANNELS.onExportCapture]: CaptureProgress;
  [IPC_EVENT_CHANNELS.onExportDone]: ExportOutcome;
  [IPC_EVENT_CHANNELS.onPreparing]: void;
  [IPC_EVENT_CHANNELS.onPrepareProgress]: PrepareProgress;
  [IPC_EVENT_CHANNELS.onUpdateReady]: void;
  [IPC_EVENT_CHANNELS.onUpdateRestartFailed]: StructuredError;
  [IPC_EVENT_CHANNELS.onArchiveScanProgress]: ArchiveScanProgress;
}

export type AppBridge<TLocale extends string = string> = {
  [K in InvokeMethodName]: (
    ...args: IpcInvokeMap<TLocale>[(typeof IPC_INVOKE_CHANNELS)[K]]['args']
  ) => Promise<IpcInvokeMap<TLocale>[(typeof IPC_INVOKE_CHANNELS)[K]]['result']>;
} & {
  [K in EventMethodName]: (
    cb: IpcEventMap[(typeof IPC_EVENT_CHANNELS)[K]] extends void
      ? () => void
      : (payload: IpcEventMap[(typeof IPC_EVENT_CHANNELS)[K]]) => void,
  ) => () => void;
};

export type IpcHandler<C extends IpcInvokeChannel, TLocale extends string = string> = (
  ...args: IpcInvokeMap<TLocale>[C]['args']
) => IpcInvokeMap<TLocale>[C]['result'] | Promise<IpcInvokeMap<TLocale>[C]['result']>;

export type IpcHandlerMap<TLocale extends string = string> = {
  [C in IpcInvokeChannel]: IpcHandler<C, TLocale>;
};

export type IpcEventSender = <C extends IpcEventChannel>(
  channel: C,
  ...args: IpcEventMap[C] extends void ? [] : [payload: IpcEventMap[C]]
) => void;
