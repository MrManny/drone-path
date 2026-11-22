import { describe, expect, it } from 'vitest';

import type { StructuredError } from '../../shared/errors.js';
import { describeError } from '../../ui/lib/errortext.js';

describe.for([
  {
    code: 'FS_EXISTS',
    name: 'blocked-folder',
    detail: "EEXIST: file already exists, mkdir 'E:\\exports\\blocked-folder'",
    lead: 'A file named "blocked-folder" is in the way.',
  },
  {
    code: 'FS_NOT_FOUND',
    name: 'gone.mp4',
    detail: "ENOENT: no such file or directory, open 'E:\\clips\\gone.mp4'",
    lead: '"gone.mp4" was not found.',
  },
  {
    code: 'FS_ACCESS_DENIED',
    name: 'out.mp4',
    detail: "EACCES: permission denied, open 'E:\\locked\\out.mp4'",
    lead: 'Access to "out.mp4" was denied.',
  },
  {
    code: 'FS_BUSY',
    name: 'a.partial.mp4',
    detail: "EBUSY: resource busy or locked, rename 'E:\\exports\\a.partial.mp4'",
    lead: '"a.partial.mp4" is in use by another program.',
  },
  {
    code: 'FS_IS_DIRECTORY',
    name: 'exports',
    detail: "EISDIR: illegal operation on a directory, open 'E:\\exports'",
    lead: '"exports" is a folder, not a file.',
  },
])('Filesystem code $code', ({ code, name, detail, lead }) => {
  it('maps the structured code to a sentence that names the file', () => {
    const { text, technical } = describeError({ code, params: { name }, detail });
    expect(text).toContain(lead);
    expect(text).toContain(name);
    expect(text).not.toMatch(/^E[A-Z]+:/);
    expect(technical).toBe(detail);
  });
});

describe('Filesystem codes without a path', () => {
  it('still gives an actionable sentence', () => {
    expect(describeError({ code: 'FS_EXISTS', detail: 'EEXIST: file already exists, mkdir' })).toEqual({
      text: 'A file is in the way. Choose another folder or file name.',
      technical: 'EEXIST: file already exists, mkdir',
    });
  });

  it('names no file for a full disk', () => {
    const detail = 'ENOSPC: no space left on device, write';
    expect(describeError({ code: 'FS_DISK_FULL', detail })).toEqual({
      text: 'The disk is full. Free some space or choose another drive.',
      technical: detail,
    });
  });
});

describe.for<{ error: StructuredError; text: string; technical: string | null }>([
  {
    error: { code: 'NO_RECORDING', detail: 'no recording loaded' },
    text: 'No recording is loaded. Open a recording first.',
    technical: 'no recording loaded',
  },
  {
    error: { code: 'EXPORT_ALREADY_RUNNING', detail: 'an export is already running' },
    text: 'An export is already running. Wait for it to finish or cancel it.',
    technical: 'an export is already running',
  },
  {
    error: { code: 'EXPORT_COULD_NOT_START' },
    text: 'The export could not start. Try again.',
    technical: 'EXPORT_COULD_NOT_START',
  },
  {
    error: { code: 'EXPORT_COULD_NOT_BE_CANCELED' },
    text: 'The export could not be canceled. Try again.',
    technical: 'EXPORT_COULD_NOT_BE_CANCELED',
  },
  {
    error: { code: 'OUTPUT_OVERWRITES_SOURCE', detail: 'the output must not overwrite the source recording' },
    text: 'The export would replace the source recording. Choose another file name.',
    technical: 'the output must not overwrite the source recording',
  },
  {
    error: { code: 'OUTPUT_PATH_ABSOLUTE', detail: 'output path must be absolute: E:\\exports\\out.mp4' },
    text: 'The export needs a full path to its destination. Choose the destination again.',
    technical: 'output path must be absolute: E:\\exports\\out.mp4',
  },
  {
    error: { code: 'APP_BRIDGE_UNAVAILABLE', detail: 'app bridge unavailable' },
    text: 'The app cannot reach its own services. Restart the app.',
    technical: 'app bridge unavailable',
  },
  {
    error: { code: 'RENDER_CANCELED', detail: 'render canceled' },
    text: 'Export canceled; its unfinished file was removed.',
    technical: 'render canceled',
  },
  {
    error: {
      code: 'OUTPUT_VERIFICATION',
      params: { frames: 120, fps: '30', expectedFrames: 121, expectedFps: '60000/1001' },
      detail: 'output verification failed: got 120 frames @ 30, expected 121 @ 60000/1001',
    },
    text: 'The finished file has 120 frames at 30 fps, but 121 at 60000/1001 fps were expected. Try exporting again.',
    technical: 'output verification failed: got 120 frames @ 30, expected 121 @ 60000/1001',
  },
  {
    error: { code: 'OUTPUT_VERIFICATION', detail: 'output verification failed' },
    text: 'The finished file does not match the recording frame count or frame rate. Try exporting again.',
    technical: 'output verification failed',
  },
  {
    error: { code: 'NO_FRAME_RATE', detail: 'could not determine the frame rate of the video' },
    text: "The recording's frame rate could not be read. Choose a different recording.",
    technical: 'could not determine the frame rate of the video',
  },
  {
    error: { code: 'NO_TELEMETRY', detail: 'no telemetry found: no CAM meta (DVTM) stream and no .SRT sidecar' },
    text: 'This recording has no GPS flight data. Choose a recording that was flown with GPS.',
    technical: 'no telemetry found: no CAM meta (DVTM) stream and no .SRT sidecar',
  },
  {
    error: { code: 'ACTION_FAILED' },
    text: 'The action could not be completed. Try again.',
    technical: 'ACTION_FAILED',
  },
  {
    error: { code: 'TRACK_SAVE_FAILED' },
    text: 'The telemetry file could not be saved. Try again.',
    technical: 'TRACK_SAVE_FAILED',
  },
  {
    error: { code: 'REVEAL_FAILED' },
    text: 'The file could not be revealed. Try again.',
    technical: 'REVEAL_FAILED',
  },
])('structured error $error.code', ({ error, text, technical }) => {
  it('maps directly by code without prose regexes and keeps technical details', () => {
    expect(describeError(error)).toEqual({ text, technical });
  });
});

describe('structured errors that carry params', () => {
  it('names only the file from params for NOT_READABLE_MP4', () => {
    const detail = 'not a readable .mp4 file: C:\\Windows\\win.ini';
    expect(describeError({ code: 'NOT_READABLE_MP4', params: { name: 'win.ini' }, detail })).toEqual({
      text: '"win.ini" is not a readable .mp4 recording. Choose a different .mp4 file.',
      technical: detail,
    });
  });

  it('points to the kept file from params when COULD_NOT_REPLACE_OUTPUT occurs', () => {
    const detail =
      'could not replace E:\\exports\\a.mp4: EBUSY: resource busy or locked ' +
      '(the finished render is at E:\\exports\\a.partial.mp4)';
    const { text, technical } = describeError({
      code: 'COULD_NOT_REPLACE_OUTPUT',
      params: { path: 'E:\\exports\\a.partial.mp4' },
      detail,
    });
    expect(text).toContain('The exported file is kept at E:\\exports\\a.partial.mp4.');
    expect(text).toContain('Move it to the destination yourself.');
    expect(technical).toBe(detail);
  });
});

describe('uncataloged backend/IPC error codes (#394)', () => {
  it.for<{ error: StructuredError; technical: string }>([
    {
      error: { code: 'PICK_IN_PROGRESS', detail: 'a pick is already in progress' },
      technical: 'PICK_IN_PROGRESS: a pick is already in progress',
    },
    {
      error: { code: 'OUTPUT_NOT_APPROVED', detail: 'output path was not approved by save dialog' },
      technical: 'OUTPUT_NOT_APPROVED: output path was not approved by save dialog',
    },
    {
      error: { code: 'UNKNOWN_OUTPUT', detail: 'unknown output' },
      technical: 'UNKNOWN_OUTPUT: unknown output',
    },
    {
      error: { code: 'INVALID_LANGUAGE', detail: 'invalid app language' },
      technical: 'INVALID_LANGUAGE: invalid app language',
    },
    {
      error: { code: 'OPEN_FAILED', detail: 'No application associated' },
      technical: 'OPEN_FAILED: No application associated',
    },
    {
      error: { code: 'EIO', detail: 'EIO: input/output error' },
      technical: 'EIO: input/output error',
    },
    {
      error: { code: 'BACKEND_ERROR', detail: 'ffmpeg exited with code 1' },
      technical: 'BACKEND_ERROR: ffmpeg exited with code 1',
    },
  ])('preserves actionable code $error.code rather than falling through to errors.unknown', ({ error, technical }) => {
    expect(describeError(error)).toEqual({
      text: 'The action could not be completed. Try again.',
      technical,
    });
  });
});

describe('UNKNOWN error', () => {
  it('maps to errors.unknown and drops empty technical details', () => {
    expect(describeError({ code: 'UNKNOWN', detail: 'boom' })).toEqual({
      text: 'Something went wrong. Try again.',
      technical: 'boom',
    });
    expect(describeError({ code: 'UNKNOWN' })).toEqual({
      text: 'Something went wrong. Try again.',
      technical: null,
    });
  });
});
