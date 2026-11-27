import fs from 'node:fs';
import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { scanArchive } from 'drone-path-archive/indexed-scan';
import { analyzeArchiveSharpness } from 'drone-path-archive/sharpness';
import { requireFfmpegTools } from 'drone-path-core/ffmpeg';

import { main } from '../src/cli.js';

vi.mock('drone-path-archive/indexed-scan');
vi.mock('drone-path-archive/sharpness');
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

it('routes archive analyze-sharpness with options and writes JSON summary to stdout', async () => {
  const analysisResult = {
    clip: {
      path: 'clip.mp4', status: 'ok' as const, availability: 'online' as const, size: 100, mtimeMs: 1,
      video: null, cameraCreationTime: null, telemetry: null, bbox: null, track: [], error: null,
    },
    clipKey: 'clip.mp4',
    cached: false,
    run: {
      runId: 1,
      clipKey: 'clip.mp4',
      fingerprintKey: '{"size":100,"mtimeMs":1}',
      method: 'ffmpeg-blurdetect',
      version: '1',
      settings: { mode: 'every-frame' as const, stride: 1, analysisWidth: 480, minEdgeCoverage: 0.01 },
      sampleCount: 10,
      analyzedAtMs: 1234,
    },
  };
  vi.mocked(analyzeArchiveSharpness).mockResolvedValue(analysisResult);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const before = process.listenerCount('SIGINT');

  await main([
    'node', 'drone-path', 'archive', 'analyze-sharpness', 'clip.mp4',
    '--mode', 'every-frame', '--analysis-width', '480', '--min-edge-coverage', '0.01',
    '--force', '--archive-db', 'test.sqlite', '--json',
  ]);

  expect(analyzeArchiveSharpness).toHaveBeenCalledWith(
    path.resolve('test.sqlite'),
    'clip.mp4',
    expect.objectContaining({
      mode: 'every-frame',
      analysisWidth: 480,
      minEdgeCoverage: 0.01,
      force: true,
    }),
  );
  expect(output.mock.calls).toEqual([[JSON.stringify(analysisResult) + '\n']]);
  expect(error.mock.calls).toEqual([
    ['[drone-path] stored 10 sharpness sample(s) for clip.mp4\n'],
  ]);
  expect(process.listenerCount('SIGINT')).toBe(before);
});
