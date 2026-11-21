import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { probeVideo } from 'drone-path-core/ffmpeg';

import { cleanupTmpDirs, probeFixture, productMetaPacket, SRT_SAMPLE, tmpDir } from '../../../test/fixtures/core.js';
import { camMetaMp4 } from '../../../test/fixtures/mp4-cammeta.js';
import { scanArchive } from '../src/indexed-scan.js';
import { listArchiveFlights, nearArchive } from '../src/query.js';
import { ArchiveStore } from '../src/store.js';

vi.mock('drone-path-core/ffmpeg', { spy: true });

const probe = vi.mocked(probeVideo);
const meta = probeFixture({ camMeta: null });
const getTools = vi.fn(async () => ({ ffmpeg: 'ffmpeg-unused', ffprobe: 'ffprobe-unused' }));

function setup() {
  const dir = fs.realpathSync(tmpDir());
  const db = path.join(dir, 'db', 'archive.sqlite');
  const root = path.join(dir, 'media');
  const file = path.join(root, 'flight.mp4');
  fs.mkdirSync(root);
  fs.writeFileSync(file, 'video');
  return { db, root, file, options: { db, getTools } };
}

function inspect(db: string) {
  const store = new ArchiveStore(db);
  try {
    const snapshot = store.snapshot();
    return snapshot.clips.map((clip) => ({
      ...clip,
      overview: store.readOverview(clip.key),
      samples: store.readSamples(clip.key),
    }));
  } finally {
    store.close();
  }
}

beforeEach(() => {
  probe.mockReset().mockResolvedValue(meta);
  getTools.mockClear();
});
afterEach(cleanupTmpDirs);

it('reuses unchanged clips and reprobes after video and sidecar changes', async () => {
  const { db, root, file, options } = setup();
  const sidecar = path.join(root, 'flight.SRT');
  const first = await scanArchive([root], options);
  expect(first[0]?.status).toBe('no-telemetry');
  await expect(scanArchive([root], options)).resolves.toEqual(first);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(getTools).toHaveBeenCalledTimes(1);

  fs.appendFileSync(file, ' update');
  await expect(scanArchive([root], options)).resolves.toMatchObject([{ size: 12 }]);
  fs.writeFileSync(sidecar, SRT_SAMPLE);
  await expect(scanArchive([root], options)).resolves.toMatchObject([{ status: 'ok' }]);
  expect(inspect(db)[0]).toMatchObject({
    overview: [[{ tSec: 0 }], [{ tSec: 0.066 }]],
    samples: [{ tSec: 0, segment: 0 }, { tSec: 0.066, segment: 1 }],
  });
  fs.appendFileSync(sidecar, '\n');
  await scanArchive([root], options);
  fs.rmSync(sidecar);
  await expect(scanArchive([root], options)).resolves.toMatchObject([{ status: 'no-telemetry' }]);
  expect(inspect(db)[0]?.samples).toEqual([]);
  expect(probe).toHaveBeenCalledTimes(5);
});

it('backfills flight memberships on query without invalidating existing media fingerprints or samples', async () => {
  const { db, root, file, options } = setup();
  fs.writeFileSync(path.join(root, 'flight.SRT'), SRT_SAMPLE);
  const first = await scanArchive([root], options);
  const before = inspect(db);
  const legacy = new DatabaseSync(db);
  try {
    legacy.exec('DROP TABLE clip_gaze; DROP TABLE clip_flights; PRAGMA user_version = 1');
  } finally {
    legacy.close();
  }

  const flights = listArchiveFlights(db);
  expect(flights).toMatchObject([{ flightId: expect.any(String), clips: [{ path: file, splitFromKey: null }] }]);
  await expect(scanArchive([root], options)).resolves.toEqual(first);
  expect(getTools).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(inspect(db)).toEqual(before);
  expect(listArchiveFlights(db)).toEqual(flights);
});

it('retries cached errors and reuses the record after a successful retry', async () => {
  const { db, root, options } = setup();
  probe.mockRejectedValueOnce(new Error('temporary probe failure'));
  await expect(scanArchive([root], options)).resolves.toMatchObject([{ status: 'error' }]);
  expect(inspect(db)).toMatchObject([{ record: { status: 'error', error: 'temporary probe failure' } }]);

  const recovered = await scanArchive([root], options);
  expect(recovered).toMatchObject([{ status: 'no-telemetry', error: null }]);
  await expect(scanArchive([root], options)).resolves.toEqual(recovered);
  expect(probe).toHaveBeenCalledTimes(2);
});

it('keeps disconnected clips offline, reconnects without probing, and prunes in scope', async () => {
  const { db, root, file, options } = setup();
  const other = path.join(path.dirname(root), 'media-other');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'other.mp4'), '');
  const displaced = path.join(path.dirname(root), 'displaced');
  await scanArchive([root, other], options);

  fs.renameSync(root, displaced);
  await expect(scanArchive([root], options)).resolves.toEqual([]);
  expect(inspect(db)).toHaveLength(2);
  expect(inspect(db).find(({ record }) => record.path === file)?.availability).toBe('offline');
  fs.renameSync(displaced, root);
  await expect(scanArchive([root], options)).resolves.toHaveLength(1);
  expect(inspect(db).find(({ record }) => record.path === file)?.availability).toBe('online');
  expect(probe).toHaveBeenCalledTimes(2);

  fs.renameSync(root, displaced);
  await scanArchive([root], { ...options, prune: true });
  await expect(scanArchive([root], { ...options, prune: true })).resolves.toEqual([]);
  expect(inspect(db)).toMatchObject([{ record: { path: path.join(other, 'other.mp4') }, availability: 'online' }]);
});

it('does not prune nested clips when scanning only the top level', async () => {
  const { db, root, options } = setup();
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested);
  const child = path.join(nested, 'child.mp4');
  fs.writeFileSync(child, '');
  await scanArchive([root], { ...options, recurse: true });
  fs.rmSync(child);
  await scanArchive([root], { ...options, prune: true });
  expect(inspect(db)).toHaveLength(2);
  await scanArchive([root], { ...options, prune: true, recurse: true });
  expect(inspect(db)).toHaveLength(1);
});

it('leaves the prior index intact when footage changes during a probe', async () => {
  const { db, root, file, options } = setup();
  await scanArchive([root], options);
  fs.appendFileSync(file, ' changed');
  probe.mockImplementationOnce(async () => {
    fs.appendFileSync(file, ' again');
    return meta;
  });
  await expect(scanArchive([root], options)).rejects.toThrow('recording changed during scan');
  expect(inspect(db)).toMatchObject([{ record: { size: 5 } }]);
});

it('rejects a stale concurrent scan and leaves the newer result intact', async () => {
  const { db, root, options } = setup();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  probe.mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    return probeFixture({ creationTime: 'older', camMeta: null });
  }).mockResolvedValueOnce(probeFixture({ creationTime: 'newer', camMeta: null }));

  const stale = scanArchive([root], options);
  const verified = expect(stale).rejects.toThrow('archive index changed during scan');
  await started.promise;
  try {
    await scanArchive([root], options);
  } finally {
    release.resolve();
  }
  await verified;
  expect(inspect(db)).toMatchObject([{ record: { cameraCreationTime: 'newer' } }]);
});

it('leaves the index intact if a running scan is canceled', async () => {
  const { db, root, file, options } = setup();
  await scanArchive([root], options);
  fs.appendFileSync(file, ' changed');
  const controller = new AbortController();
  const reason = new Error('scan interrupted');
  probe.mockImplementationOnce(async () => {
    controller.abort(reason);
    return meta;
  });
  await expect(scanArchive([root], { ...options, signal: controller.signal })).rejects.toBe(reason);
  expect(inspect(db)).toMatchObject([{ record: { size: 5 } }]);
});

it.each([true, false])('backfills migrated DVTM once even with usable gaze = %s', async (withAngle) => {
  const { db, root, file, options } = setup();
  const point = { lat: 46, lon: 14 };
  const packet = productMetaPacket(point.lat, point.lon, {
    relAltMm: 50000, ...(withAngle ? { gimbal: { pitch: -900 } } : {}),
  });
  fs.writeFileSync(file, camMetaMp4('ordinary', [packet, packet, packet]).file);
  probe.mockResolvedValue(probeFixture({ camMeta: { index: 1, trackId: 3 } }));
  await scanArchive([root], options);
  const legacy = new DatabaseSync(db);
  try {
    legacy.exec('DROP TABLE clip_gaze; PRAGMA user_version = 2');
  } finally {
    legacy.close();
  }
  const matches = () => nearArchive(db, point, 10, true).filter(({ matchType }) => matchType === 'gaze');
  expect(matches()).toEqual([]);
  expect(probe).toHaveBeenCalledTimes(1);

  const disconnected = root + '-disconnected';
  fs.renameSync(root, disconnected);
  await scanArchive([root], options);
  expect(inspect(db)[0]).toMatchObject({ availability: 'offline', gazePending: true });
  fs.renameSync(disconnected, root);

  probe.mockRejectedValueOnce(new Error('temporary sharing violation'));
  expect(await scanArchive([root], options)).toMatchObject([{ status: 'error' }]);
  expect(inspect(db)[0]).toMatchObject({ availability: 'online', gazePending: true, record: { status: 'ok' } });
  expect(await scanArchive([root], options)).toMatchObject([{ status: 'ok' }]);
  expect(matches()).toHaveLength(withAngle ? 1 : 0);
  if (withAngle) expect(matches()[0]?.tSec).toBe(0);
  expect(inspect(db)[0]).toMatchObject({ gazePending: false });

  await scanArchive([root], options);
  expect(probe).toHaveBeenCalledTimes(3);
});
