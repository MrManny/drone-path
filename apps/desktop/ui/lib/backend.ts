import { codedDesktopError } from '../../shared/errors.js';
import type {
  AppBridge as SharedAppBridge,
  ArchiveAvailability,
  ArchiveClipDto,
  ArchiveFlightClipDto,
  ArchiveFlightDto,
  ArchiveNearHit,
  ArchivePickFolderResult,
  ArchiveQueryFilters,
  ArchiveQueryResult,
  ArchiveRemoveRootResult,
  ArchiveScanProgress,
  ArchiveScanResult,
  ArchiveScanStatus,
  ArchiveTrackPoint,
  ExportOutcome,
  ExportOutputPayload,
  IpcAck,
  OpenArchiveClipRequest,
  PickOutputResult,
  PickRequest,
  PickResult,
  TrackSaveRequest,
  UiSession,
  UpdateState,
} from '../../shared/ipc.js';
import type { Locale } from '../../shared/desktop-i18n/loader.js';

export type {
  ArchiveAvailability,
  ArchiveClipDto,
  ArchiveFlightClipDto,
  ArchiveFlightDto,
  ArchiveNearHit,
  ArchivePickFolderResult,
  ArchiveQueryFilters,
  ArchiveQueryResult,
  ArchiveRemoveRootResult,
  ArchiveScanProgress,
  ArchiveScanResult,
  ArchiveScanStatus,
  ArchiveTrackPoint,
  ExportOutcome,
  ExportOutputPayload,
  IpcAck,
  OpenArchiveClipRequest,
  PickOutputResult,
  PickRequest,
  PickResult,
  TrackSaveRequest,
  UiSession,
  UpdateState,
};
export type ExportAck = IpcAck;
export type IpcResult = IpcAck;

export type AppBridge = SharedAppBridge<Locale>;

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
  if (!bridge) throw codedDesktopError('APP_BRIDGE_UNAVAILABLE', 'app bridge unavailable');
  return bridge;
}
