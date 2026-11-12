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
} from '../../src/errors.js';

export interface ErrorText {
  text: string;
  technical: string | null;
}

const NODE_CODE = /^(EEXIST|ENOENT|EACCES|EPERM|ENOSPC|EBUSY|EISDIR): /;

function quotedPath(message: string): string | null {
  const match = /'([^']+)'(?: -> '[^']*')?$/.exec(message);
  return match ? match[1] : null;
}

function leafName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

interface NodeSentence {
  lead: (name: string | null) => string;
  advice: string;
}

const NODE_SENTENCES: Record<string, NodeSentence> = {
  EEXIST: {
    lead: (name) => (name ? `A file named "${name}" is in the way.` : 'A file is in the way.'),
    advice: 'Choose another folder or file name.',
  },
  ENOENT: {
    lead: (name) => (name ? `"${name}" was not found.` : 'The file or folder was not found.'),
    advice: 'Check that it still exists.',
  },
  EACCES: {
    lead: (name) => (name ? `Access to "${name}" was denied.` : 'Access was denied.'),
    advice: 'Choose a location you can write to.',
  },
  EPERM: {
    lead: (name) => (name ? `Access to "${name}" was denied.` : 'Access was denied.'),
    advice: 'Choose a location you can write to.',
  },
  ENOSPC: {
    lead: () => 'The disk is full.',
    advice: 'Free some space or choose another drive.',
  },
  EBUSY: {
    lead: (name) => (name ? `"${name}" is in use by another program.` : 'The file is in use by another program.'),
    advice: 'Close it and try again.',
  },
  EISDIR: {
    lead: (name) => (name ? `"${name}" is a folder, not a file.` : 'A folder is in the way.'),
    advice: 'Choose a different file name.',
  },
};

// Patterns derive from the src/errors.ts message vocabulary so the backend
// wording and its UI sentence cannot drift apart.
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactMessage = (message: string): RegExp => new RegExp(`^${escaped(message)}$`);
const messagePrefix = (prefix: string): RegExp => new RegExp(`^${escaped(prefix)}`);

const APP_SENTENCES: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => string]> = [
  [exactMessage(ERR_NO_RECORDING), () => 'No recording is loaded. Open a recording first.'],
  [exactMessage(ERR_EXPORT_ALREADY_RUNNING), () => 'An export is already running. Wait for it to finish or cancel it.'],
  [exactMessage(ERR_EXPORT_COULD_NOT_START), () => 'The export could not start. Try again.'],
  [exactMessage(ERR_EXPORT_COULD_NOT_BE_CANCELED), () => 'The export could not be canceled. Try again.'],
  [
    exactMessage(ERR_OUTPUT_OVERWRITES_SOURCE),
    () => 'The export would replace the source recording. Choose another file name.',
  ],
  [messagePrefix(ERR_OUTPUT_PATH_ABSOLUTE), () => 'The export needs a full path to its destination.'],
  [exactMessage(ERR_APP_BRIDGE_UNAVAILABLE), () => 'The app backend is not available. Restart the app.'],
  [exactMessage(ERR_RENDER_CANCELED), () => 'The export was canceled.'],
  [
    new RegExp(`^${escaped(ERR_NOT_READABLE_MP4)}(.+)$`),
    (m) => `"${leafName(m[1])}" is not a readable .mp4 recording.`,
  ],
  [
    messagePrefix(ERR_NO_TELEMETRY),
    () => 'This recording has no GPS flight data. Choose a recording that was flown with GPS.',
  ],
  [
    messagePrefix(ERR_OUTPUT_VERIFICATION),
    () => 'The finished file does not match the recording frame count or frame rate.',
  ],
  [
    new RegExp(`^${escaped(ERR_COULD_NOT_REPLACE)}.*\\(${escaped(ERR_RENDER_KEPT_AT)}(.+)\\)$`),
    (m) =>
      `The export finished, but its file could not replace the destination. The render is kept at ${m[1]}.`,
  ],
  [exactMessage(ERR_NO_FRAME_RATE), () => "This video's frame rate could not be read."],
  [exactMessage(ERR_UNKNOWN), () => 'Something went wrong. Try again.'],
];

export function describeError(message: string): ErrorText {
  const node = NODE_CODE.exec(message);
  if (node) {
    const sentence = NODE_SENTENCES[node[1]];
    const path = quotedPath(message);
    const name = path === null ? null : leafName(path);
    return { text: `${sentence.lead(name)} ${sentence.advice}`, technical: message };
  }
  for (const [pattern, render] of APP_SENTENCES) {
    const match = pattern.exec(message);
    if (match) return { text: render(match), technical: message };
  }
  return { text: message, technical: null };
}
