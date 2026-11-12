import { describe, expect, it } from 'vitest';

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
import { describeError } from '../../ui/lib/errortext.js';

describe.for([
  {
    code: 'EEXIST',
    raw: "EEXIST: file already exists, mkdir 'E:\\exports\\blocked-folder'",
    name: 'blocked-folder',
    lead: 'A file named "blocked-folder" is in the way.',
  },
  {
    code: 'ENOENT',
    raw: "ENOENT: no such file or directory, open 'E:\\clips\\gone.mp4'",
    name: 'gone.mp4',
    lead: '"gone.mp4" was not found.',
  },
  {
    code: 'EACCES',
    raw: "EACCES: permission denied, open 'E:\\locked\\out.mp4'",
    name: 'out.mp4',
    lead: 'Access to "out.mp4" was denied.',
  },
  {
    code: 'EPERM',
    raw: "EPERM: operation not permitted, unlink 'E:\\locked\\out.mp4'",
    name: 'out.mp4',
    lead: 'Access to "out.mp4" was denied.',
  },
  {
    code: 'EBUSY',
    raw: "EBUSY: resource busy or locked, rename 'E:\\exports\\a.partial.mp4'",
    name: 'a.partial.mp4',
    lead: '"a.partial.mp4" is in use by another program.',
  },
  {
    code: 'EISDIR',
    raw: "EISDIR: illegal operation on a directory, open 'E:\\exports'",
    name: 'exports',
    lead: '"exports" is a folder, not a file.',
  },
])('Node $code', ({ raw, name, lead }) => {
  it('rewrites the message into a sentence that names the file', () => {
    const { text, technical } = describeError(raw);
    expect(text).toContain(lead);
    expect(text).toContain(name);
    expect(text).not.toMatch(/^E[A-Z]+:/);
    expect(technical).toBe(raw);
  });
});

describe('Node messages without a path', () => {
  it('still gives an actionable sentence', () => {
    expect(describeError('EEXIST: file already exists, mkdir')).toEqual({
      text: 'A file is in the way. Choose another folder or file name.',
      technical: 'EEXIST: file already exists, mkdir',
    });
  });

  it('names no file for a full disk', () => {
    const raw = 'ENOSPC: no space left on device, write';
    expect(describeError(raw)).toEqual({
      text: 'The disk is full. Free some space or choose another drive.',
      technical: raw,
    });
  });
});

describe.for([
  { raw: 'no recording loaded', text: 'No recording is loaded. Open a recording first.' },
  {
    raw: 'an export is already running',
    text: 'An export is already running. Wait for it to finish or cancel it.',
  },
  { raw: 'export could not start', text: 'The export could not start. Try again.' },
  { raw: 'export could not be canceled', text: 'The export could not be canceled. Try again.' },
  {
    raw: 'the output must not overwrite the source recording',
    text: 'The export would replace the source recording. Choose another file name.',
  },
  { raw: 'app bridge unavailable', text: 'The app backend is not available. Restart the app.' },
  { raw: 'unknown error', text: 'Something went wrong. Try again.' },
  {
    raw: 'output verification failed: got 120 frames @ 30, expected 121 @ 60000/1001',
    text: 'The finished file does not match the recording frame count or frame rate.',
  },
  {
    raw: 'could not determine the frame rate of the video',
    text: "This video's frame rate could not be read.",
  },
  {
    raw: 'no telemetry found: no CAM meta (DVTM) stream and no .SRT sidecar',
    text: 'This recording has no GPS flight data. Choose a recording that was flown with GPS.',
  },
  {
    raw: 'no telemetry found: the CAM meta (DVTM) stream has no GPS fix pairs; the .SRT sidecar is only consulted when no CAM meta stream is present',
    text: 'This recording has no GPS flight data. Choose a recording that was flown with GPS.',
  },
])('app message "$raw"', ({ raw, text }) => {
  it('rewrites it and keeps the original as technical details', () => {
    expect(describeError(raw)).toEqual({ text, technical: raw });
  });
});

describe('app messages that carry a path', () => {
  it('names only the file for an unreadable recording', () => {
    const raw = 'not a readable .mp4 file: C:\\Windows\\win.ini';
    expect(describeError(raw)).toEqual({
      text: '"win.ini" is not a readable .mp4 recording.',
      technical: raw,
    });
  });

  it('points to the kept render when the finished file cannot replace the destination', () => {
    const raw =
      'could not replace E:\\exports\\a.mp4: EBUSY: resource busy or locked, rename ' +
      "'E:\\exports\\a.partial.mp4' -> 'E:\\exports\\a.mp4' " +
      '(the finished render is at E:\\exports\\a.partial.mp4)';
    const { text, technical } = describeError(raw);
    expect(text).toContain('The render is kept at E:\\exports\\a.partial.mp4.');
    expect(technical).toBe(raw);
  });
});

describe.for([{ message: 'boom' }, { message: 'Disk on fire: 42' }, { message: '' }])(
  'unknown message "$message"',
  ({ message }) => {
    it('passes through unchanged with no technical details', () => {
      expect(describeError(message)).toEqual({ text: message, technical: null });
    });
  },
);

// N-1 contract: the APP_SENTENCES patterns are built from these throw-site
// constants (src/errors.ts), so pinning both the frozen wording and the
// mapping keeps a reworded producer from silently losing its UI sentence.
describe.for([
  {
    name: 'ERR_NO_RECORDING',
    constant: ERR_NO_RECORDING,
    message: 'no recording loaded',
    raw: ERR_NO_RECORDING,
    text: 'No recording is loaded. Open a recording first.',
  },
  {
    name: 'ERR_EXPORT_ALREADY_RUNNING',
    constant: ERR_EXPORT_ALREADY_RUNNING,
    message: 'an export is already running',
    raw: ERR_EXPORT_ALREADY_RUNNING,
    text: 'An export is already running. Wait for it to finish or cancel it.',
  },
  {
    name: 'ERR_EXPORT_COULD_NOT_START',
    constant: ERR_EXPORT_COULD_NOT_START,
    message: 'export could not start',
    raw: ERR_EXPORT_COULD_NOT_START,
    text: 'The export could not start. Try again.',
  },
  {
    name: 'ERR_EXPORT_COULD_NOT_BE_CANCELED',
    constant: ERR_EXPORT_COULD_NOT_BE_CANCELED,
    message: 'export could not be canceled',
    raw: ERR_EXPORT_COULD_NOT_BE_CANCELED,
    text: 'The export could not be canceled. Try again.',
  },
  {
    name: 'ERR_OUTPUT_OVERWRITES_SOURCE',
    constant: ERR_OUTPUT_OVERWRITES_SOURCE,
    message: 'the output must not overwrite the source recording',
    raw: ERR_OUTPUT_OVERWRITES_SOURCE,
    text: 'The export would replace the source recording. Choose another file name.',
  },
  {
    name: 'ERR_OUTPUT_PATH_ABSOLUTE',
    constant: ERR_OUTPUT_PATH_ABSOLUTE,
    message: 'output path must be absolute: ',
    raw: `${ERR_OUTPUT_PATH_ABSOLUTE}E:\\exports\\out.mp4`,
    text: 'The export needs a full path to its destination.',
  },
  {
    name: 'ERR_APP_BRIDGE_UNAVAILABLE',
    constant: ERR_APP_BRIDGE_UNAVAILABLE,
    message: 'app bridge unavailable',
    raw: ERR_APP_BRIDGE_UNAVAILABLE,
    text: 'The app backend is not available. Restart the app.',
  },
  {
    name: 'ERR_RENDER_CANCELED',
    constant: ERR_RENDER_CANCELED,
    message: 'render canceled',
    raw: ERR_RENDER_CANCELED,
    text: 'The export was canceled.',
  },
  {
    name: 'ERR_NOT_READABLE_MP4',
    constant: ERR_NOT_READABLE_MP4,
    message: 'not a readable .mp4 file: ',
    raw: `${ERR_NOT_READABLE_MP4}C:\\Windows\\win.ini`,
    text: '"win.ini" is not a readable .mp4 recording.',
  },
  {
    name: 'ERR_NO_TELEMETRY',
    constant: ERR_NO_TELEMETRY,
    message: 'no telemetry found: ',
    raw: `${ERR_NO_TELEMETRY}no CAM meta (DVTM) stream and no .SRT sidecar`,
    text: 'This recording has no GPS flight data. Choose a recording that was flown with GPS.',
  },
  {
    name: 'ERR_OUTPUT_VERIFICATION',
    constant: ERR_OUTPUT_VERIFICATION,
    message: 'output verification failed: ',
    raw: `${ERR_OUTPUT_VERIFICATION}got 120 frames @ 30, expected 121 @ 60000/1001`,
    text: 'The finished file does not match the recording frame count or frame rate.',
  },
  {
    name: 'ERR_COULD_NOT_REPLACE',
    constant: ERR_COULD_NOT_REPLACE,
    message: 'could not replace ',
    raw:
      `${ERR_COULD_NOT_REPLACE}E:\\exports\\a.mp4: EBUSY: resource busy or locked ` +
      `(${ERR_RENDER_KEPT_AT}E:\\exports\\a.partial.mp4)`,
    text: 'The export finished, but its file could not replace the destination. The render is kept at E:\\exports\\a.partial.mp4.',
  },
  {
    name: 'ERR_NO_FRAME_RATE',
    constant: ERR_NO_FRAME_RATE,
    message: 'could not determine the frame rate of the video',
    raw: ERR_NO_FRAME_RATE,
    text: "This video's frame rate could not be read.",
  },
  {
    name: 'ERR_UNKNOWN',
    constant: ERR_UNKNOWN,
    message: 'unknown error',
    raw: ERR_UNKNOWN,
    text: 'Something went wrong. Try again.',
  },
])('error protocol constant $name', ({ constant, message, raw, text }) => {
  it('keeps its frozen wording and maps to its app sentence', () => {
    expect(constant).toBe(message);
    expect(describeError(raw)).toEqual({ text, technical: raw });
  });
});

it('pins the kept-render fragment wording', () => {
  expect(ERR_RENDER_KEPT_AT).toBe('the finished render is at ');
});
