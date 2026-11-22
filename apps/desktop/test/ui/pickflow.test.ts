import { describe, expect, it, vi } from 'vitest';

import type { StructuredError } from '../../shared/errors.js';
import type { PickResult, UiSession } from '../../shared/ipc.js';
import { pickRecordingFlow } from '../../ui/lib/pickflow.js';

const SESSION = {
  video: { src: 'app://bundle/media/video', fps: 30, frames: 300, width: 1280, height: 720 },
  durationSec: 10,
} as unknown as UiSession;

describe('pickRecordingFlow', () => {
  it('picks, loads and commits the session, then reports picked', async () => {
    const commit = vi.fn();
    const deps = {
      pickRecording: vi.fn(async (): Promise<PickResult> => ({ ok: true })),
      getSession: vi.fn(async () => SESSION),
    };
    const event = await pickRecordingFlow(deps, commit);
    expect(event).toEqual({ type: 'picked' });
    expect(commit).toHaveBeenCalledWith(SESSION);
    expect(deps.pickRecording).toHaveBeenCalledTimes(1);
    expect(deps.getSession).toHaveBeenCalledTimes(1);
  });

  it('reports a canceled picker without loading anything', async () => {
    const commit = vi.fn();
    const deps = {
      pickRecording: vi.fn(async (): Promise<PickResult> => ({ ok: false, canceled: true })),
      getSession: vi.fn(async () => SESSION),
    };
    const event = await pickRecordingFlow(deps, commit);
    expect(event).toEqual({ type: 'canceled' });
    expect(deps.getSession).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe.each<{
  what: string;
  pickRecording: () => Promise<PickResult>;
  getSession: () => Promise<UiSession | null>;
  error: StructuredError;
}>([
  {
    what: 'the picker reports an error',
    pickRecording: async () => ({
      ok: false,
      code: 'NOT_READABLE_MP4',
      params: { name: 'bad.mp4' },
      detail: 'not a readable .mp4 file: /media/bad.mp4',
    }),
    getSession: async () => SESSION,
    error: {
      code: 'NOT_READABLE_MP4',
      params: { name: 'bad.mp4' },
      detail: 'not a readable .mp4 file: /media/bad.mp4',
    },
  },
  {
    what: 'the picker fails without a code',
    pickRecording: async () => ({ ok: false } as PickResult),
    getSession: async () => SESSION,
    error: { code: 'UNKNOWN' },
  },
  {
    what: 'no recording was loaded',
    pickRecording: async () => ({ ok: true }),
    getSession: async () => null,
    error: { code: 'NO_RECORDING' },
  },
  {
    what: 'the picker throws',
    pickRecording: async () => {
      throw new Error('the picker went away');
    },
    getSession: async () => SESSION,
    error: { code: 'BACKEND_ERROR', detail: 'the picker went away' },
  },
  {
    what: 'loading the session throws',
    pickRecording: async () => ({ ok: true }),
    getSession: async () => {
      throw new Error('the session loader went away');
    },
    error: { code: 'BACKEND_ERROR', detail: 'the session loader went away' },
  },
])('when $what', ({ pickRecording, getSession, error }) => {
  it('returns the failure and commits nothing', async () => {
    const commit = vi.fn();
    const event = await pickRecordingFlow({ pickRecording, getSession }, commit);
    expect(event).toEqual({ type: 'failed', error });
    expect(commit).not.toHaveBeenCalled();
  });
});
