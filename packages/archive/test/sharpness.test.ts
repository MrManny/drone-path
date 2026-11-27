import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeVideo } from 'drone-path-core/ffmpeg';
import { analyzeClipSharpness } from 'drone-path-core/sharpness';
import type * as coreSharpnessModule from 'drone-path-core/sharpness';

import { cleanupTmpDirs, probeFixture, tmpDir } from '../../../test/fixtures/core.js';
import { scanArchive } from '../src/indexed-scan.js';
import {
  DEFAULT_SHARPNESS_QUERY_LIMIT,
  MAX_SHARPNESS_QUERY_LIMIT,
  analyzeArchiveSharpness,
  exportArchiveSharpnessNdjson,
  getArchiveSharpness,
} from '../src/sharpness.js';
import { ArchiveStore } from '../src/store.js';

vi.mock('drone-path-core/ffmpeg', { spy: true });
vi.mock('drone-path-core/sharpness', async (importOriginal) => {
  const actual = await importOriginal<typeof coreSharpnessModule>();
  return {
    ...actual,
    analyzeClipSharpness: vi.fn(),
  };
});

const probe = vi.mocked(probeVideo);
const analyzeClip = vi.mocked(analyzeClipSharpness);
const getTools = vi.fn(async () => ({ ffmpeg: 'ffmpeg-unused', ffprobe: 'ffprobe-unused' }));

function setupClip() {
  const dir = fs.realpathSync(tmpDir());
  const db = path.join(dir, 'db', 'archive.sqlite');
  const root = path.join(dir, 'media');
  const file = path.join(root, 'DJI_0001.MP4');
  fs.mkdirSync(root);
  fs.writeFileSync(file, 'video-bytes');
  return { dir, db, root, file };
}

beforeEach(() => {
  probe.mockReset().mockResolvedValue(
    probeFixture({ fps: { num: 30, den: 1, value: 30, str: '30' }, frames: 90, durationSec: 3, camMeta: null }),
  );
  analyzeClip.mockReset();
  getTools.mockClear();
});

afterEach(cleanupTmpDirs);

describe('archive sharpness timelines', () => {
  it('leaves sharpness empty during ordinary scanArchive and caches matching analyzeArchiveSharpness runs', async () => {
    const { db, root, file } = setupClip();
    await scanArchive([root], { db, getTools });
    expect(analyzeClip).not.toHaveBeenCalled();

    const rawBefore = new DatabaseSync(db);
    try {
      expect(rawBefore.prepare('SELECT COUNT(*) AS count FROM sharpness_runs').get()?.count).toBe(0);
    } finally {
      rawBefore.close();
    }

    getTools.mockClear();
    analyzeClip.mockResolvedValue({
      analyzer: { method: 'ffmpeg-blurdetect', version: '1' },
      mode: 'sampled',
      stride: 30,
      analysisWidth: 640,
      minEdgeCoverage: 0.002,
      samples: [
        { frameIndex: 0, tSec: 0, sharpnessScore: 45, edgeCoverage: 0.01 },
        { frameIndex: 30, tSec: 1, sharpnessScore: null, edgeCoverage: 0.0005 },
        { frameIndex: 60, tSec: 2, sharpnessScore: 60.5, edgeCoverage: 0.025 },
      ],
    });

    const first = await analyzeArchiveSharpness(db, file, { getTools });
    expect(first.cached).toBe(false);
    expect(first.run.settings).toEqual({
      mode: 'sampled',
      stride: 30,
      analysisWidth: 640,
      minEdgeCoverage: 0.002,
    });
    expect(first.run.sampleCount).toBe(3);
    expect(analyzeClip).toHaveBeenCalledTimes(1);
    expect(analyzeClip).toHaveBeenCalledWith(
      expect.any(Object),
      file,
      expect.objectContaining({ mode: 'sampled', fps: 30, analysisWidth: 640, minEdgeCoverage: 0.002 }),
    );

    // Repeat call with matching fingerprint, analyzer, and settings reuses cached run without spawning FFmpeg.
    getTools.mockClear();
    const second = await analyzeArchiveSharpness(db, file, { getTools });
    expect(second.cached).toBe(true);
    expect(second.run.runId).toBe(first.run.runId);
    expect(getTools).not.toHaveBeenCalled();
    expect(analyzeClip).toHaveBeenCalledTimes(1);

    // Different mode produces a distinct cached run.
    analyzeClip.mockResolvedValueOnce({
      analyzer: { method: 'ffmpeg-blurdetect', version: '1' },
      mode: 'every-frame',
      stride: 1,
      analysisWidth: 640,
      minEdgeCoverage: 0.002,
      samples: [
        { frameIndex: 0, tSec: 0, sharpnessScore: 45, edgeCoverage: 0.01 },
        { frameIndex: 1, tSec: 0.033333, sharpnessScore: 44, edgeCoverage: 0.01 },
      ],
    });
    const every = await analyzeArchiveSharpness(db, file, { mode: 'every-frame', getTools });
    expect(every.cached).toBe(false);
    expect(every.run.runId).not.toBe(first.run.runId);
    expect(every.run.settings.stride).toBe(1);

    // File modification invalidates cache via new fingerprint.
    fs.appendFileSync(file, 'more-bytes');
    analyzeClip.mockResolvedValueOnce({
      analyzer: { method: 'ffmpeg-blurdetect', version: '1' },
      mode: 'sampled',
      stride: 30,
      analysisWidth: 640,
      minEdgeCoverage: 0.002,
      samples: [{ frameIndex: 0, tSec: 0, sharpnessScore: 70, edgeCoverage: 0.03 }],
    });
    const afterModify = await analyzeArchiveSharpness(db, file, { getTools });
    expect(afterModify.cached).toBe(false);
    expect(afterModify.run.fingerprintKey).not.toBe(first.run.fingerprintKey);
  });

  it('never leaves incomplete runs when analysis is aborted or fails', async () => {
    const { db, root, file } = setupClip();
    await scanArchive([root], { db, getTools });

    const abortErr = new Error('user canceled');
    analyzeClip.mockRejectedValueOnce(abortErr);
    await expect(analyzeArchiveSharpness(db, file, { getTools })).rejects.toBe(abortErr);

    const timeline = getArchiveSharpness(db, file);
    expect(timeline.analyzed).toBe(false);
    expect(timeline.run).toBeNull();
    expect(timeline.samples).toEqual([]);
  });

  it('queries timelines offline with time-range filters, bounded paging, and full NDJSON export', async () => {
    const { dir, db, root, file } = setupClip();
    const samples = Array.from({ length: 12 }, (_, idx) => ({
      frameIndex: idx * 30,
      tSec: idx,
      sharpnessScore: idx === 5 ? null : 40 + idx,
      edgeCoverage: idx === 5 ? 0.0005 : 0.01 + idx * 0.001,
    }));
    analyzeClip.mockResolvedValueOnce({
      analyzer: { method: 'ffmpeg-blurdetect', version: '1' },
      mode: 'sampled',
      stride: 30,
      analysisWidth: 640,
      minEdgeCoverage: 0.002,
      samples,
    });

    await analyzeArchiveSharpness(db, file, { getTools });

    // Move source directory away and rescan so clip is marked offline.
    const displaced = path.join(dir, 'displaced');
    fs.renameSync(root, displaced);
    await scanArchive([root], { db, getTools });

    const offlinePage = getArchiveSharpness(db, file, { startSec: 2, endSec: 8, limit: 3, offset: 2 });
    expect(offlinePage).toMatchObject({
      clipPath: file,
      availability: 'offline',
      analyzed: true,
      totalSamples: 7,
      limit: 3,
      offset: 2,
      truncated: true,
    });
    expect(offlinePage.samples.map((s) => s.frameIndex)).toEqual([120, 150, 180]);
    expect(offlinePage.samples[1]?.sharpnessScore).toBeNull();

    const defaultPage = getArchiveSharpness(db, file);
    expect(defaultPage.limit).toBe(DEFAULT_SHARPNESS_QUERY_LIMIT);
    expect(defaultPage.truncated).toBe(false);
    expect(defaultPage.samples).toHaveLength(12);

    const outNdjson = path.join(dir, 'exports', 'timeline.ndjson');
    const exported = exportArchiveSharpnessNdjson(db, file, { startSec: 1, endSec: 3, outPath: outNdjson });
    expect(exported.count).toBe(3);
    expect(exported.availability).toBe('offline');
    const lines = fs.readFileSync(outNdjson, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual(samples.slice(1, 4));

    // Refuses to overwrite existing export file by default, unless overwrite: true is set.
    expect(() =>
      exportArchiveSharpnessNdjson(db, file, { startSec: 1, endSec: 3, outPath: outNdjson }),
    ).toThrow('refusing to overwrite existing sharpness export file');
    const overwritten = exportArchiveSharpnessNdjson(db, file, {
      startSec: 1,
      endSec: 2,
      outPath: outNdjson,
      overwrite: true,
    });
    expect(overwritten.count).toBe(2);

    expect(() => exportArchiveSharpnessNdjson(db, file, { outPath: db })).toThrow(
      'export file cannot overwrite the archive database',
    );
    expect(() => exportArchiveSharpnessNdjson(db, file, { outPath: `${db}-wal` })).toThrow(
      'export file cannot overwrite the archive database',
    );
    expect(() => exportArchiveSharpnessNdjson(db, file, { outPath: file, overwrite: true })).toThrow(
      'export file cannot overwrite the source recording',
    );
  });

  it('ignores stale fingerprint runs on default queries while preserving explicit runId and rejecting mid-analysis edits', async () => {
    const { db, root, file } = setupClip();
    analyzeClip.mockResolvedValueOnce({
      analyzer: { method: 'ffmpeg-blurdetect', version: '1' },
      mode: 'sampled',
      stride: 30,
      analysisWidth: 640,
      minEdgeCoverage: 0.002,
      samples: [{ frameIndex: 0, tSec: 0, sharpnessScore: 45, edgeCoverage: 0.01 }],
    });
    const first = await analyzeArchiveSharpness(db, file, { getTools });

    // Modify the clip on disk and rescan without re-running sharpness analysis.
    fs.appendFileSync(file, '-updated');
    await scanArchive([root], { db, getTools });

    // Default lookup must not return stale results for the previous fingerprint.
    const staleDefault = getArchiveSharpness(db, file);
    expect(staleDefault.analyzed).toBe(false);
    expect(staleDefault.run).toBeNull();
    expect(() => exportArchiveSharpnessNdjson(db, file)).toThrow('no sharpness analysis found for clip');

    // Explicit runId still retrieves the historical run.
    const byId = getArchiveSharpness(db, file, { runId: first.run.runId });
    expect(byId.analyzed).toBe(true);
    expect(byId.run?.runId).toBe(first.run.runId);

    // Reject mid-run file changes before publishing.
    analyzeClip.mockImplementationOnce(async () => {
      fs.appendFileSync(file, '-mutated-mid-run');
      return {
        analyzer: { method: 'ffmpeg-blurdetect', version: '1' },
        mode: 'sampled',
        stride: 30,
        analysisWidth: 640,
        minEdgeCoverage: 0.002,
        samples: [{ frameIndex: 0, tSec: 0, sharpnessScore: 60, edgeCoverage: 0.02 }],
      };
    });
    await expect(analyzeArchiveSharpness(db, file, { getTools })).rejects.toThrow(
      'recording changed during sharpness analysis',
    );
  });

  it('validates discovered SRT sidecars via assertAllowedPath before reading and rejects mid-scan sidecar changes', async () => {
    const { db, root, file } = setupClip();
    const srt = path.join(root, 'DJI_0001.SRT');
    fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\n[latitude: 46.6] [longitude: 14.2]\n');

    await expect(
      analyzeArchiveSharpness(db, file, {
        getTools,
        assertAllowedPath: (target) => {
          if (target.endsWith('.SRT')) throw new Error('sidecar outside allowed roots');
        },
      }),
    ).rejects.toThrow('sidecar outside allowed roots');

    probe.mockImplementationOnce(async () => {
      fs.appendFileSync(srt, '\n');
      return probeFixture({ fps: { num: 30, den: 1, value: 30, str: '30' }, frames: 90, durationSec: 3, camMeta: null });
    });
    await expect(analyzeArchiveSharpness(db, file, { getTools })).rejects.toThrow(
      'recording changed during sharpness analysis',
    );
  });

  it('validates query bounds and missing clips', () => {
    const { dir, db, file } = setupClip();
    new ArchiveStore(db).close();

    expect(() => getArchiveSharpness(db, file)).toThrow('clip is not indexed in archive');
    expect(() => getArchiveSharpness(db, file, { startSec: 5, endSec: 2 })).toThrow(
      'expected startSec at or before endSec',
    );
    expect(() =>
      getArchiveSharpness(db, file, { limit: MAX_SHARPNESS_QUERY_LIMIT + 1 }),
    ).toThrow(`between 1 and ${MAX_SHARPNESS_QUERY_LIMIT}`);
    expect(() => getArchiveSharpness(db, file, { offset: -1 })).toThrow(
      'expected offset to be a non-negative integer',
    );
    expect(() => exportArchiveSharpnessNdjson(db, path.join(dir, 'missing.mp4'))).toThrow(
      'clip is not indexed in archive',
    );
  });
});
