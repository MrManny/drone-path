import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { listArchive, listArchiveFlights, nearArchive, parseDateBound } from 'drone-path-archive/query';
import type { ArchiveClip } from 'drone-path-archive/query';

import { main } from '../src/cli.js';

vi.mock('drone-path-archive/query', { spy: true });

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
  expect(nearArchive).toHaveBeenCalledWith(expect.any(String), { lat: -20, lon: 179.5 }, 50);
  expect(output.mock.calls).toEqual([[JSON.stringify(hits) + '\n']]);
  expect(error).not.toHaveBeenCalled();
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
