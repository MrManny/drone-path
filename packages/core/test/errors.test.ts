import { afterEach, describe, expect, it, vi } from 'vitest';

import { ERROR_PREFIX, codedError, errorMessage, runToolMain } from '../src/errors.js';

it.for([
  { name: 'Error', value: new Error('boom'), want: 'boom' },
  { name: 'Error subclass', value: new TypeError('bad type'), want: 'bad type' },
  { name: 'string throw', value: 'string failure', want: 'string failure' },
  { name: 'number throw', value: 42, want: '42' },
  { name: 'null throw', value: null, want: 'null' },
])('errorMessage: $name', ({ value, want }) => {
  expect(errorMessage(value)).toBe(want);
});

describe('runToolMain', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints the ERROR line and sets exitCode for an Error, without rethrowing', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runToolMain(() => {
      throw new Error('boom');
    });
    expect(write).toHaveBeenCalledWith(`${ERROR_PREFIX}boom\n`);
    expect(process.exitCode).toBe(1);
  });

  it('turns a non-Error throw into String(e) in the ERROR line', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runToolMain(() => {
      throw 'string failure';
    });
    expect(write).toHaveBeenCalledWith(`${ERROR_PREFIX}string failure\n`);
    expect(process.exitCode).toBe(1);
  });

  it('runs the work unchanged and stays quiet when nothing throws', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const done: string[] = [];
    await runToolMain(() => {
      done.push('ran');
    });
    expect(done).toEqual(['ran']);
    expect(write).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('awaits asynchronous tool work before returning', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let finished = false;
    await runToolMain(async () => {
      await Promise.resolve();
      finished = true;
    });
    expect(finished).toBe(true);
  });
});

describe('codedError', () => {
  it('attaches structured code, optional params, and cause onto an Error', () => {
    const cause = new Error('inner');
    const err = codedError('outer failure', {
      code: 'OUTPUT_VERIFICATION',
      params: { frames: 10, expectedFrames: 12 },
      cause,
    }) as Error & { code?: string; params?: Record<string, string | number> };
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('outer failure');
    expect(err.code).toBe('OUTPUT_VERIFICATION');
    expect(err.params).toEqual({ frames: 10, expectedFrames: 12 });
    expect(err.cause).toBe(cause);
  });

  it('leaves params and cause undefined when omitted', () => {
    const err = codedError('missing fps', { code: 'NO_FRAME_RATE' }) as Error & {
      code?: string;
      params?: Record<string, string | number>;
    };
    expect(err.code).toBe('NO_FRAME_RATE');
    expect('params' in err).toBe(false);
    expect('cause' in err).toBe(false);
  });
});
