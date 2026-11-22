import { tEnglish } from '../../shared/desktop-i18n/loader.js';
import type { Translate } from '../../shared/desktop-i18n/loader.js';
import type { DesktopErrorCode, StructuredError } from '../../shared/errors.js';

interface ErrorText {
  text: string;
  technical: string | null;
}

// One cancel sentence for every surface — the form notice after a canceled
// run and the RENDER_CANCELED mapping below — so one event never reads two
// ways (#282).
export function canceledSentence(t: Translate): string {
  return t('errors.exportCanceled');
}

const CODE_MESSAGES: Partial<Record<DesktopErrorCode, (error: StructuredError, t: Translate) => string>> = {
  NO_RECORDING: (_error, t) => t('errors.noRecording'),
  EXPORT_ALREADY_RUNNING: (_error, t) => t('errors.exportRunning'),
  EXPORT_COULD_NOT_START: (_error, t) => t('errors.exportStart'),
  EXPORT_COULD_NOT_BE_CANCELED: (_error, t) => t('errors.exportCancel'),
  OUTPUT_OVERWRITES_SOURCE: (_error, t) => t('errors.overwriteSource'),
  OUTPUT_PATH_ABSOLUTE: (_error, t) => t('errors.absolutePath'),
  APP_BRIDGE_UNAVAILABLE: (_error, t) => t('errors.bridgeUnavailable'),
  RENDER_CANCELED: (_error, t) => canceledSentence(t),
  NOT_READABLE_MP4: (error, t) =>
    t('errors.invalidRecording', { name: String(error.params?.name ?? '') }),
  NO_TELEMETRY: (_error, t) => t('errors.noTelemetry'),
  OUTPUT_VERIFICATION: (error, t) => {
    const p = error.params;
    if (
      p &&
      p.frames !== undefined &&
      p.fps !== undefined &&
      p.expectedFrames !== undefined &&
      p.expectedFps !== undefined
    ) {
      return t('errors.verificationMismatch', {
        frames: p.frames,
        fps: p.fps,
        expectedFrames: p.expectedFrames,
        expectedFps: p.expectedFps,
      });
    }
    return t('errors.verification');
  },
  COULD_NOT_REPLACE_OUTPUT: (error, t) =>
    t('errors.replaceExport', { path: String(error.params?.path ?? '') }),
  NO_FRAME_RATE: (_error, t) => t('errors.noFrameRate'),
  ACTION_FAILED: (_error, t) => t('errors.actionFailed'),
  TRACK_SAVE_FAILED: (_error, t) => t('errors.trackSave'),
  REVEAL_FAILED: (_error, t) => t('errors.reveal'),
  FS_EXISTS: (error, t) =>
    error.params?.name
      ? t('errors.fileExistsNamed', { name: String(error.params.name) })
      : t('errors.fileExists'),
  FS_NOT_FOUND: (error, t) =>
    error.params?.name
      ? t('errors.fileNotFoundNamed', { name: String(error.params.name) })
      : t('errors.fileNotFound'),
  FS_ACCESS_DENIED: (error, t) =>
    error.params?.name
      ? t('errors.accessDeniedNamed', { name: String(error.params.name) })
      : t('errors.accessDenied'),
  FS_DISK_FULL: (_error, t) => t('errors.diskFull'),
  FS_BUSY: (error, t) =>
    error.params?.name
      ? t('errors.fileInUseNamed', { name: String(error.params.name) })
      : t('errors.fileInUse'),
  FS_IS_DIRECTORY: (error, t) =>
    error.params?.name
      ? t('errors.isDirectoryNamed', { name: String(error.params.name) })
      : t('errors.isDirectory'),
  UNKNOWN: (_error, t) => t('errors.unknown'),
};

export function describeError(error: StructuredError, t: Translate = tEnglish): ErrorText {
  const render = Object.hasOwn(CODE_MESSAGES, error.code)
    ? CODE_MESSAGES[error.code as DesktopErrorCode]
    : undefined;
  if (render) {
    const technical = error.code === 'UNKNOWN'
      ? (error.detail !== undefined && error.detail !== '' ? error.detail : null)
      : (error.detail ?? error.code);
    return { text: render(error, t), technical };
  }
  // Uncataloged backend/IPC codes preserve their actionable code instead of
  // falling through to errors.unknown.
  const detail = error.detail ?? '';
  const technical = detail
    ? (detail.startsWith(`${error.code}:`) ? detail : `${error.code}: ${detail}`)
    : error.code;
  return { text: t('errors.actionFailed'), technical };
}
