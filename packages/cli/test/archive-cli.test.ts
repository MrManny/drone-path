import fs from 'node:fs';
import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { scanArchive } from 'drone-path-archive/indexed-scan';
import { requireFfmpegTools } from 'drone-path-core/ffmpeg';

import { main } from '../src/cli.js';

vi.mock('drone-path-archive/indexed-scan');
vi.mock('drone-path-core/ffmpeg', { spy: true });

afterEach(() => vi.restoreAllMocks());

it('routes archive scan to the scanner and sends only NDJSON to stdout', async () => {
  const record = {
    path: 'test.mp4', status: 'no-telemetry' as const, size: 10, mtimeMs: 1,
    video: null, cameraCreationTime: null, telemetry: null, bbox: null, track: [], error: null,
  };
  vi.mocked(requireFfmpegTools).mockResolvedValue();
  vi.mocked(scanArchive).mockImplementation(async (_dirs, options) => {
    options.onRecord?.(record);
    return [record];
  });
  const output = vi.spyOn(fs, 'writeSync').mockReturnValue(0);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const before = process.listenerCount('SIGINT');

  await main([
    'node', 'drone-path', 'archive', 'scan', 'dir1', 'dir2',
    '--recurse', '--prune', '--archive-db', 'test.sqlite', '--json',
  ]);

  expect(scanArchive).toHaveBeenCalledWith(['dir1', 'dir2'], expect.objectContaining({
    db: path.resolve('test.sqlite'), recurse: true, prune: true,
  }));
  expect(requireFfmpegTools).not.toHaveBeenCalled();
  expect(output.mock.calls).toEqual([[1, JSON.stringify(record) + '\n']]);
  expect(error.mock.calls).toEqual([
    ['[drone-path] no-telemetry: test.mp4\n'],
    ['[drone-path] scanned 1 recording(s)\n'],
  ]);
  expect(process.listenerCount('SIGINT')).toBe(before);
});
