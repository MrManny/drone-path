import { describe, expect, it } from 'vitest';

import { codedError } from 'drone-path-core/errors';
import {
  classifyError,
  codedDesktopError,
  fromIpcFailure,
  leafName,
  structuredError,
} from '../shared/errors.js';

describe('leafName', () => {
  it('extracts the final segment across Windows and POSIX separators', () => {
    expect(leafName('E:\\clips\\flight.mp4')).toBe('flight.mp4');
    expect(leafName('/exports/flight.mp4/')).toBe('flight.mp4');
    expect(leafName('plain.mp4')).toBe('plain.mp4');
  });
});

describe('classifyError', () => {
  it('preserves explicit desktop error code and params', () => {
    const err = codedDesktopError(
      'COULD_NOT_REPLACE_OUTPUT',
      'could not replace out.mp4',
      { path: 'E:\\exports\\a.partial.mp4' },
    );
    expect(classifyError(err)).toEqual({
      code: 'COULD_NOT_REPLACE_OUTPUT',
      detail: 'could not replace out.mp4',
      params: { path: 'E:\\exports\\a.partial.mp4' },
    });
  });

  it('lets an outermost desktop domain code win over a wrapped Node errno cause', () => {
    const cause = Object.assign(new Error('EBUSY: resource busy'), {
      code: 'EBUSY',
      path: 'E:\\exports\\a.mp4',
    });
    const outer = codedDesktopError(
      'COULD_NOT_REPLACE_OUTPUT',
      'could not replace a.mp4',
      { path: 'E:\\exports\\a.partial.mp4' },
      cause,
    );
    expect(classifyError(outer)).toEqual({
      code: 'COULD_NOT_REPLACE_OUTPUT',
      detail: 'could not replace a.mp4',
      params: { path: 'E:\\exports\\a.partial.mp4' },
    });
  });

  it.for([
    { errno: 'EEXIST', code: 'FS_EXISTS' },
    { errno: 'ENOENT', code: 'FS_NOT_FOUND' },
    { errno: 'EACCES', code: 'FS_ACCESS_DENIED' },
    { errno: 'EPERM', code: 'FS_ACCESS_DENIED' },
    { errno: 'ENOSPC', code: 'FS_DISK_FULL' },
    { errno: 'EBUSY', code: 'FS_BUSY' },
    { errno: 'EISDIR', code: 'FS_IS_DIRECTORY' },
  ])('maps Node $errno to $code and extracts the path leaf name', ({ errno, code }) => {
    const err = Object.assign(new Error(`${errno}: operation failed`), {
      code: errno,
      path: '/locked/out.mp4',
    });
    expect(classifyError(err)).toEqual({
      code,
      detail: `${errno}: operation failed`,
      params: { name: 'out.mp4' },
    });
  });

  it('unwraps wrapped plain Errors to recover underlying Node errno codes', () => {
    const fsErr = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
      path: 'C:\\Users\\test\\AppData\\state.json',
    });
    const wrapped = new Error('cannot write app state state.json: EACCES: permission denied', {
      cause: fsErr,
    });
    expect(classifyError(wrapped)).toEqual({
      code: 'FS_ACCESS_DENIED',
      detail: 'cannot write app state state.json: EACCES: permission denied',
      params: { name: 'state.json' },
    });
  });

  it('preserves uncataloged error codes verbatim rather than dropping to UNKNOWN', () => {
    const ioErr = Object.assign(new Error('EIO: input/output error'), { code: 'EIO' });
    expect(classifyError(ioErr)).toEqual({
      code: 'EIO',
      detail: 'EIO: input/output error',
    });
  });

  it('maps ZodError causes to INVALID_REQUEST', () => {
    const zodErr = Object.assign(new Error('validation failed'), { name: 'ZodError' });
    const wrapped = new Error('unknown track save request key extra', { cause: zodErr });
    expect(classifyError(wrapped)).toEqual({
      code: 'INVALID_REQUEST',
      detail: 'unknown track save request key extra',
    });
  });

  it('uses fallbackCode BACKEND_ERROR for uncataloged plain throws', () => {
    expect(classifyError(new Error('ffmpeg exited with code 1'))).toEqual({
      code: 'BACKEND_ERROR',
      detail: 'ffmpeg exited with code 1',
    });
    expect(classifyError('string boom')).toEqual({
      code: 'BACKEND_ERROR',
      detail: 'string boom',
    });
  });

  it('handles circular error causes without infinite recursion', () => {
    const a = new Error('first') as Error & { cause?: unknown };
    const b = new Error('second', { cause: a }) as Error & { cause?: unknown };
    a.cause = b;
    expect(classifyError(a)).toEqual({
      code: 'BACKEND_ERROR',
      detail: 'first',
    });
  });

  it('preserves core/engine codedError metadata', () => {
    const err = codedError('output verification failed: got 10 frames @ 30, expected 12 @ 30', {
      code: 'OUTPUT_VERIFICATION',
      params: { frames: 10, fps: '30', expectedFrames: 12, expectedFps: '30' },
    });
    expect(classifyError(err)).toEqual({
      code: 'OUTPUT_VERIFICATION',
      detail: 'output verification failed: got 10 frames @ 30, expected 12 @ 30',
      params: { frames: 10, fps: '30', expectedFrames: 12, expectedFps: '30' },
    });
  });
});

describe('fromIpcFailure', () => {
  it('uses the failure code when present and falls back otherwise', () => {
    expect(fromIpcFailure({ code: 'NO_RECORDING', detail: 'no recording loaded' }, 'UNKNOWN')).toEqual({
      code: 'NO_RECORDING',
      detail: 'no recording loaded',
    });
    expect(fromIpcFailure({}, 'EXPORT_COULD_NOT_START')).toEqual(
      structuredError('EXPORT_COULD_NOT_START'),
    );
  });
});
