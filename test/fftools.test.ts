import { describe, expect, it } from 'vitest';

import { pickFfTool, resolveFfTools } from '../src/fftools.js';
import type { FfToolName } from '../src/fftools.js';

const never = (): boolean => false;

describe('pickFfTool', () => {
  it('uses a path-like override that exists', () => {
    expect(
      pickFfTool('ffmpeg', '/opt/ff/ffmpeg', ['/bin/ffmpeg'], (f) => f === '/opt/ff/ffmpeg'),
    ).toBe('/opt/ff/ffmpeg');
  });

  it('keeps a bare-name override verbatim without touching the filesystem', () => {
    let checks = 0;
    const exists = (): boolean => {
      checks += 1;
      return false;
    };
    expect(pickFfTool('ffprobe', 'my-ffprobe', ['/bin/ffprobe'], exists)).toBe('my-ffprobe');
    expect(checks).toBe(0);
  });

  it.each([
    ['ffmpeg', '/missing/ffmpeg', 'invalid --ffmpeg override: no such file: /missing/ffmpeg'],
    [
      'ffprobe',
      'C:\\tools\\ffprobe.exe',
      'invalid --ffprobe override: no such file: C:\\tools\\ffprobe.exe',
    ],
  ] as const)(
    'rejects the missing %s path override naming its flag',
    (tool, override, message) => {
      expect(() => pickFfTool(tool, override, [], never)).toThrow(message);
    },
  );

  it('returns the first existing embedded candidate', () => {
    expect(
      pickFfTool('ffmpeg', null, ['/packaged/ffmpeg', '/dev/ffmpeg'], (f) => f === '/dev/ffmpeg'),
    ).toBe('/dev/ffmpeg');
    expect(
      pickFfTool('ffmpeg', null, ['/packaged/ffmpeg', '/dev/ffmpeg'], (f) => f !== ''),
    ).toBe('/packaged/ffmpeg');
  });

  it('skips absent candidates and falls back to the bare tool name', () => {
    expect(pickFfTool('ffmpeg', null, [null, '/dev/ffmpeg'], never)).toBe('ffmpeg');
    expect(pickFfTool('ffprobe', null, [], never)).toBe('ffprobe');
  });
});

describe('resolveFfTools', () => {
  const env = {
    exists: (file: string) => file === '/dev/ffprobe',
    candidates: (tool: FfToolName): (string | null)[] => [
      tool === 'ffmpeg' ? '/packaged/ffmpeg' : '/dev/ffprobe',
    ],
  };

  it('resolves each tool through its own override and candidates', () => {
    expect(resolveFfTools({ ffmpeg: 'my-ffmpeg', ffprobe: null }, env)).toEqual({
      ffmpeg: 'my-ffmpeg',
      ffprobe: '/dev/ffprobe',
    });
  });

  it('falls back per tool when nothing is embedded', () => {
    const bare = { exists: never, candidates: (): (string | null)[] => [null] };
    expect(resolveFfTools({ ffmpeg: null, ffprobe: null }, bare)).toEqual({
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe',
    });
  });
});
