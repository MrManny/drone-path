import { tEnglish } from '../../shared/desktop-i18n/loader.js';
import type { Translate } from '../../shared/desktop-i18n/loader.js';
import {
  ERR_APP_BRIDGE_UNAVAILABLE,
  ERR_COULD_NOT_REPLACE,
  ERR_EXPORT_ALREADY_RUNNING,
  ERR_EXPORT_COULD_NOT_BE_CANCELED,
  ERR_EXPORT_COULD_NOT_START,
  ERR_NO_FRAME_RATE,
  ERR_NO_RECORDING,
  ERR_NO_TELEMETRY,
  ERR_NOT_READABLE_MP4,
  ERR_OUTPUT_OVERWRITES_SOURCE,
  ERR_OUTPUT_PATH_ABSOLUTE,
  ERR_OUTPUT_VERIFICATION,
  ERR_RENDER_KEPT_AT,
  ERR_RENDER_CANCELED,
  ERR_UNKNOWN,
} from 'drone-path-core/errors';

interface ErrorText {
  text: string;
  technical: string | null;
}

// One cancel sentence for every surface — the form notice after a canceled
// run and the ERR_RENDER_CANCELED mapping below — so one event never reads
// two ways (#282).
export function canceledSentence(t: Translate): string {
  return t('errors.exportCanceled');
}

const NODE_CODE = /^(EEXIST|ENOENT|EACCES|EPERM|ENOSPC|EBUSY|EISDIR): /;

function quotedPath(message: string): string | null {
  const match = /'([^']+)'(?: -> '[^']*')?$/.exec(message);
  return match ? match[1] : null;
}

function leafName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

const NODE_SENTENCES: Record<string, (t: Translate, name: string | null) => string> = {
  EEXIST: (t, name) => name ? t('errors.fileExistsNamed', { name }) : t('errors.fileExists'),
  ENOENT: (t, name) => name ? t('errors.fileNotFoundNamed', { name }) : t('errors.fileNotFound'),
  EACCES: (t, name) => name ? t('errors.accessDeniedNamed', { name }) : t('errors.accessDenied'),
  ENOSPC: (t, _name) => t('errors.diskFull'),
  EBUSY: (t, name) => name ? t('errors.fileInUseNamed', { name }) : t('errors.fileInUse'),
  EISDIR: (t, name) => name ? t('errors.isDirectoryNamed', { name }) : t('errors.isDirectory'),
};

// Patterns derive from the core error message vocabulary so the backend
// wording and its UI sentence cannot drift apart.
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactMessage = (message: string): RegExp => new RegExp(`^${escaped(message)}$`);
const messagePrefix = (prefix: string): RegExp => new RegExp(`^${escaped(prefix)}`);

export const UI_ERR_ACTION_FAILED = 'action failed';
export const UI_ERR_TRACK_SAVE = 'track file could not be saved';
export const UI_ERR_REVEAL = 'the file could not be revealed';

const APP_SENTENCES: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray, t: Translate) => string]> = [
  [exactMessage(ERR_NO_RECORDING), (_match, t) => t('errors.noRecording')],
  [exactMessage(ERR_EXPORT_ALREADY_RUNNING), (_match, t) => t('errors.exportRunning')],
  [exactMessage(ERR_EXPORT_COULD_NOT_START), (_match, t) => t('errors.exportStart')],
  [exactMessage(ERR_EXPORT_COULD_NOT_BE_CANCELED), (_match, t) => t('errors.exportCancel')],
  [
    exactMessage(ERR_OUTPUT_OVERWRITES_SOURCE),
    (_match, t) => t('errors.overwriteSource'),
  ],
  [
    messagePrefix(ERR_OUTPUT_PATH_ABSOLUTE),
    (_match, t) => t('errors.absolutePath'),
  ],
  [exactMessage(ERR_APP_BRIDGE_UNAVAILABLE), (_match, t) => t('errors.bridgeUnavailable')],
  [exactMessage(ERR_RENDER_CANCELED), (_match, t) => canceledSentence(t)],
  [
    new RegExp(`^${escaped(ERR_NOT_READABLE_MP4)}(.+)$`),
    (m, t) => t('errors.invalidRecording', { name: leafName(m[1]) }),
  ],
  [
    messagePrefix(ERR_NO_TELEMETRY),
    (_match, t) => t('errors.noTelemetry'),
  ],
  [
    // The verification message carries the got-vs-expected numbers; surface
    // them, and keep a diagnosis-only shape when the message format changes.
    new RegExp(
      `^${escaped(ERR_OUTPUT_VERIFICATION)}got (\\d+) frames @ ([^,]+), expected (\\d+) @ (.+)$`,
    ),
    (m, t) =>
      t('errors.verificationMismatch', { frames: m[1], fps: m[2], expectedFrames: m[3], expectedFps: m[4] }),
  ],
  [
    messagePrefix(ERR_OUTPUT_VERIFICATION),
    (_match, t) => t('errors.verification'),
  ],
  [
    new RegExp(`^${escaped(ERR_COULD_NOT_REPLACE)}.*\\(${escaped(ERR_RENDER_KEPT_AT)}(.+)\\)$`),
    (m, t) =>
      t('errors.replaceExport', { path: m[1] }),
  ],
  [
    exactMessage(ERR_NO_FRAME_RATE),
    (_match, t) => t('errors.noFrameRate'),
  ],
  [exactMessage(ERR_UNKNOWN), (_match, t) => t('errors.unknown')],
  [exactMessage(UI_ERR_ACTION_FAILED), (_match, t) => t('errors.actionFailed')],
  [exactMessage(UI_ERR_TRACK_SAVE), (_match, t) => t('errors.trackSave')],
  [exactMessage(UI_ERR_REVEAL), (_match, t) => t('errors.reveal')],
];

export function describeError(message: string, t: Translate = tEnglish): ErrorText {
  const node = NODE_CODE.exec(message);
  if (node) {
    const sentence = NODE_SENTENCES[node[1] === 'EPERM' ? 'EACCES' : node[1]];
    const path = quotedPath(message);
    const name = path === null ? null : leafName(path);
    return { text: sentence(t, name), technical: message };
  }
  for (const [pattern, render] of APP_SENTENCES) {
    const match = pattern.exec(message);
    if (match) return { text: render(match, t), technical: message };
  }
  // Unmatched raw text never surfaces as the message: it goes to "Technical
  // details" behind a generic sentence with a next step.
  return { text: t('errors.unknown'), technical: message === '' ? null : message };
}
