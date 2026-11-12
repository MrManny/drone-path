import { describe, expect, it } from 'vitest';

import { pickFfmpegTool, resolveFfmpegTools } from '../src/ffmpeg-tools.js';
import type { FfmpegToolName } from '../src/ffmpeg-tools.js';

const never = (): boolean => false;

describe('pickFfmpegTool', () => {
  it('uses a path-like override that exists', () => {
    expect(
      pickFfmpegTool('ffmpeg', '/opt/ff/ffmpeg', ['/bin/ffmpeg'], (f) => f === '/opt/ff/ffmpeg'),
    ).toBe('/opt/ff/ffmpeg');
  });

  it('keeps a bare-name override verbatim without touching the filesystem', () => {
    let checks = 0;
    const exists = (): boolean => {
      checks += 1;
      return false;
    };
    expect(pickFfmpegTool('ffprobe', 'my-ffprobe', ['/bin/ffprobe'], exists)).toBe('my-ffprobe');
    expect(checks).toBe(0);
  });

  it.each([
    [
      'ffmpeg',
      '/missing/ffmpeg',
      'invalid ffmpeg override (CLI --ffmpeg or config key `ffmpeg`): no such file: /missing/ffmpeg',
    ],
    [
      'ffprobe',
      'C:\\tools\\ffprobe.exe',
      'invalid ffprobe override (CLI --ffprobe or config key `ffprobe`): no such file: C:\\tools\\ffprobe.exe',
    ],
  ] as const)(
    'rejects the missing %s path override naming the override sources',
    (tool, override, message) => {
      expect(() => pickFfmpegTool(tool, override, [], never)).toThrow(message);
    },
  );

  it('returns the first existing embedded candidate', () => {
    expect(
      pickFfmpegTool('ffmpeg', null, ['/packaged/ffmpeg', '/dev/ffmpeg'], (f) => f === '/dev/ffmpeg'),
    ).toBe('/dev/ffmpeg');
    expect(
      pickFfmpegTool('ffmpeg', null, ['/packaged/ffmpeg', '/dev/ffmpeg'], (f) => f !== ''),
    ).toBe('/packaged/ffmpeg');
  });

  it('skips absent candidates and falls back to the bare tool name', () => {
    expect(pickFfmpegTool('ffmpeg', null, [null, '/dev/ffmpeg'], never)).toBe('ffmpeg');
    expect(pickFfmpegTool('ffprobe', null, [], never)).toBe('ffprobe');
  });
});

describe('resolveFfmpegTools', () => {
  const env = {
    exists: (file: string) => file === '/dev/ffprobe',
    candidates: (tool: FfmpegToolName): (string | null)[] => [
      tool === 'ffmpeg' ? '/packaged/ffmpeg' : '/dev/ffprobe',
    ],
  };

  it('resolves each tool through its own override and candidates', () => {
    expect(resolveFfmpegTools({ ffmpeg: 'my-ffmpeg', ffprobe: null }, env)).toEqual({
      ffmpeg: 'my-ffmpeg',
      ffprobe: '/dev/ffprobe',
    });
  });

  it('falls back per tool when nothing is embedded', () => {
    const bare = { exists: never, candidates: (): (string | null)[] => [null] };
    expect(resolveFfmpegTools({ ffmpeg: null, ffprobe: null }, bare)).toEqual({
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe',
    });
  });
});
