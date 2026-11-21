import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { exportArchiveMap, exportArchiveTracks } from 'drone-path-archive/export';
import { listArchive, listArchiveFlights, listArchiveSegments, nearArchive, parseDateBound } from 'drone-path-archive/query';
import type { ArchiveClip, ArchiveSegment } from 'drone-path-archive/query';

import { main } from '../src/cli.js';

vi.mock('drone-path-archive/query', { spy: true });
vi.mock('drone-path-archive/export');

afterEach(() => vi.restoreAllMocks());

const clip: ArchiveClip = {
  path: 'flight.mp4', status: 'ok', availability: 'online', size: 1, mtimeMs: 1,
  video: null, cameraCreationTime: null, telemetry: null, bbox: null, track: [], error: null,
};

it('routes list filters and writes only a JSON array', async () => {
  vi.mocked(listArchive).mockReturnValue([clip]);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await main([
    'node', 'drone-path', 'archive', 'list', '--in-bbox', '1,175,3,-175', '--after', '2025-01-01',
    '--before', '2025-02-01T15:00:00+02:00', '--min-dist', '250', '--status', 'online',
    '--archive-db', 'query.sqlite', '--json',
  ]);
  expect(listArchive).toHaveBeenCalledWith(path.resolve('query.sqlite'), {
    bbox: { minLat: 1, minLon: 175, maxLat: 3, maxLon: -175 },
    afterMs: parseDateBound('2025-01-01'), beforeMs: parseDateBound('2025-02-01T15:00:00+02:00'),
    minDistanceM: 250, availability: 'online',
  });
  expect(output.mock.calls).toEqual([[JSON.stringify([clip]) + '\n']]);
  expect(error).not.toHaveBeenCalled();
});

it('routes negative near coordinates followed by flags', async () => {
  const hits = [{ clip, tSec: 3.5, distanceM: 20, matchType: 'track' as const }];
  vi.mocked(nearArchive).mockReturnValue(hits);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await main(['node', 'drone-path', 'archive', 'near', '-20,179.5', '--json', '--radius', '50']);
  expect(nearArchive).toHaveBeenCalledWith(expect.any(String), { lat: -20, lon: 179.5 }, 50, undefined);
  expect(output.mock.calls).toEqual([[JSON.stringify(hits) + '\n']]);
  expect(error).not.toHaveBeenCalled();
});

it('opts into camera coverage and prints the gaze result as JSON', async () => {
  const hits = [{ clip, tSec: 2.75, distanceM: 0, matchType: 'gaze' as const }];
  vi.mocked(nearArchive).mockReturnValue(hits);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await main(['node', 'drone-path', 'archive', 'near', '45,14', '--include-gaze', '--json']);
  expect(nearArchive).toHaveBeenCalledWith(expect.any(String), { lat: 45, lon: 14 }, 100, true);
  expect(output.mock.calls).toEqual([[JSON.stringify(hits) + '\n']]);
});

it('lists flight groups as JSON while honoring clip filters', async () => {
  const grouped = [{ flightId: 'first', clips: [{ ...clip, splitFromKey: null }] }];
  vi.mocked(listArchiveFlights).mockReturnValue(grouped);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await main(['node', 'drone-path', 'archive', 'list', '--group-by', 'flight', '--status', 'online', '--json']);
  expect(listArchiveFlights).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ availability: 'online' }));
  expect(output.mock.calls).toEqual([[JSON.stringify(grouped) + '\n']]);
  expect(error).not.toHaveBeenCalled();
});

it.each([
  [['near', '91,20'], 'expected a latitude,longitude pair'],
  [['near', '--unknown'], 'expected a latitude,longitude pair'],
  [['near', '46,14', '--radius', '-1'], 'expected a nonnegative distance'],
  [['list', '--in-bbox', '5,0,2,0'], 'expected south latitude'],
  [['list', '--status', 'ok'], 'expected online or offline'],
  [['list', '--after', '2025-02-01', '--before', '2025-01-01'], 'expected --after at or before --before'],
  [['list', '--min-smoothness', '1.5'], 'expected a smoothness score between 0 and 1'],
  [['list', '--min-smoothness', '-0.1'], 'expected a smoothness score between 0 and 1'],
])('rejects invalid query arguments %j', async (args, message) => {
  const previous = process.exitCode;
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    await main(['node', 'drone-path', 'archive', ...args]);
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls).toEqual([[expect.stringContaining(`[drone-path] ERROR: ${message}`)]]);
    expect(output).not.toHaveBeenCalled();
  } finally {
    process.exitCode = previous;
  }
});

it('rejects invalid --segment-type choices via Commander', async () => {
  const previous = process.exitCode;
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    await main(['node', 'drone-path', 'archive', 'list', '--segment-type', 'invalid-shot']);
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls).toEqual([[expect.stringContaining('Allowed choices are')]]);
    expect(output).not.toHaveBeenCalled();
  } finally {
    process.exitCode = previous;
  }
});


it('routes archive export commands through the list filters', async () => {
  await main(['node', 'drone-path', 'archive', 'export-map', 'out.html',
    '--archive-db', 'query.sqlite', '--status', 'offline', '--redact-launch', '150', '--include-gaze']);
  await main(['node', 'drone-path', 'archive', 'export-tracks', 'out.kmz', '--after', '2025-01-01']);
  expect(exportArchiveMap).toHaveBeenCalledWith(path.resolve('query.sqlite'), 'out.html', {
    filters: expect.objectContaining({ availability: 'offline' }), redactLaunchM: 150, includeGaze: true,
  });
  expect(exportArchiveTracks).toHaveBeenCalledWith(expect.any(String), 'out.kmz', {
    filters: expect.objectContaining({ afterMs: parseDateBound('2025-01-01') }), redactLaunchM: undefined,
  });
});

it('queries ranked segments when --segment-type or --min-smoothness is given', async () => {
  const segments: ArchiveSegment[] = [{
    clip,
    type: 'smooth-glide',
    startSec: 2,
    endSec: 14,
    durationSec: 12,
    smoothness: 0.912,
    exposureStable: true,
    meanSpeedMps: 4.5,
    meanYawRateDegPerSec: 0.2,
  }];
  vi.mocked(listArchiveSegments).mockReturnValue(segments);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await main([
    'node', 'drone-path', 'archive', 'list',
    '--segment-type', 'smooth-glide', '--min-smoothness', '0.7', '--archive-db', 'query.sqlite', '--json',
  ]);
  expect(listArchiveSegments).toHaveBeenCalledWith(path.resolve('query.sqlite'), {
    bbox: undefined, afterMs: undefined, beforeMs: undefined, minDistanceM: undefined, availability: undefined,
    segmentType: 'smooth-glide', minSmoothness: 0.7,
  });
  expect(listArchive).not.toHaveBeenCalled();
  expect(output.mock.calls).toEqual([[JSON.stringify(segments) + '\n']]);
  expect(error).not.toHaveBeenCalled();
});

it('keeps --group-by flight routing when combined with segment filters', async () => {
  const grouped = [{ flightId: 'first', clips: [{ ...clip, splitFromKey: null }] }];
  vi.mocked(listArchiveFlights).mockReturnValue(grouped);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await main([
    'node', 'drone-path', 'archive', 'list', '--group-by', 'flight', '--segment-type', 'orbit', '--json',
  ]);
  expect(listArchiveFlights).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ segmentType: 'orbit' }));
  expect(listArchiveSegments).not.toHaveBeenCalled();
  expect(output.mock.calls).toEqual([[JSON.stringify(grouped) + '\n']]);
});
