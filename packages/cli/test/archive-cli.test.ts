import fs from 'node:fs';

import { afterEach, expect, it, vi } from 'vitest';

import { scanFolders } from 'drone-path-archive/scanner';
import { requireFfmpegTools } from 'drone-path-core/ffmpeg';

import { main } from '../src/cli.js';

vi.mock('drone-path-archive/scanner');
vi.mock('drone-path-core/ffmpeg', { spy: true });

afterEach(() => vi.restoreAllMocks());

it('routes archive scan to the scanner and sends only NDJSON to stdout', async () => {
  const record = {
    path: 'test.mp4', status: 'no-telemetry' as const, size: 10, mtimeMs: 1,
    video: null, cameraCreationTime: null, telemetry: null, bbox: null, track: [], error: null,
  };
  vi.mocked(requireFfmpegTools).mockResolvedValue();
  vi.mocked(scanFolders).mockImplementation(async (_dirs, options) => {
    options.onRecord?.(record);
    return [record];
  });
  const output = vi.spyOn(fs, 'writeSync').mockReturnValue(0);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const before = process.listenerCount('SIGINT');

  await main(['node', 'drone-path', 'archive', 'scan', 'dir1', 'dir2', '--recurse', '--json']);

  expect(scanFolders).toHaveBeenCalledWith(['dir1', 'dir2'], expect.objectContaining({ recurse: true }));
  expect(output.mock.calls).toEqual([[1, JSON.stringify(record) + '\n']]);
  expect(error.mock.calls).toEqual([
    ['[drone-path] no-telemetry: test.mp4\n'],
    ['[drone-path] scanned 1 recording(s)\n'],
  ]);
  expect(process.listenerCount('SIGINT')).toBe(before);
});
