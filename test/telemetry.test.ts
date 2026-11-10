import fs from 'node:fs';
import path from 'node:path';
import type * as childProcessModule from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decodePacketSamples } from '../src/cammeta.js';
import type { PacketInfo } from '../src/cammeta.js';
import type * as ffModule from '../src/ff.js';
import type { FfToolPaths } from '../src/fftools.js';
import { parseSrtText } from '../src/srt.js';
import { loadTelemetry } from '../src/telemetry.js';
import type { LoadedTelemetry } from '../src/telemetry.js';
import {
  SRT_SAMPLE,
  SRT_SAMPLE_MIXED,
  cleanupTmpDirs,
  productMetaPacket,
  tmpDir,
  writeSrt,
} from './fixtures.js';
import type { PacketMeta } from './fixtures.js';

const mocks = vi.hoisted(() => ({ ffprobeJson: vi.fn(), execFile: vi.fn() }));

const TOOLS: FfToolPaths = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

vi.mock('../src/ff.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ffModule>()),
  ffprobeJson: mocks.ffprobeJson,
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcessModule>()),
  execFile: mocks.execFile,
}));

beforeEach(() => {
  mocks.ffprobeJson.mockReset();
  mocks.execFile.mockReset();
});
afterEach(cleanupTmpDirs);

describe('loadTelemetry (SRT source)', () => {
  it('builds per-frame values from the sidecar', async () => {
    mocks.ffprobeJson.mockResolvedValue({ streams: [] });
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    fs.writeFileSync(video, '');
    writeSrt(video, SRT_SAMPLE);

    const { telemetry: tel } = await loadTelemetry(video, {
      frames: 3,
      fpsValue: 30,
      durationSec: 0.1,
      tools: TOOLS,
    });

    expect(tel.source).toBe('srt');
    expect(tel.method).toBe('srt-cues');
    expect(tel.headingMode).toBe('cog');
    expect(tel.sampleCount).toBe(3);
    expect(tel.fixCount).toBe(2);
    expect(tel.noLock).toBe(1);
    expect(tel.frames).toHaveLength(3);

    expect(tel.frames[0].fix?.lat).toBeCloseTo(46.61307, 6);
    expect(tel.frames[0].fix?.lon).toBeCloseTo(14.262388, 6);

    expect(tel.frames[0].alt).toBeCloseTo(3.3, 6);

    expect(tel.bbox.minLat).toBeCloseTo(46.61307, 6);
    expect(tel.bbox.maxLat).toBeCloseTo(46.613071, 6);
    expect(tel.trackDistanceM).toBeGreaterThan(0);
    expect(tel.trackDistanceM).toBeLessThan(2);
  });

  it('counts fixes exactly when a cue has no lat/lon line at all', async () => {
    mocks.ffprobeJson.mockResolvedValue({ streams: [] });
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    fs.writeFileSync(video, '');
    writeSrt(video, SRT_SAMPLE_MIXED);

    const { telemetry: tel } = await loadTelemetry(video, {
      frames: 4,
      fpsValue: 30,
      durationSec: 0.133,
      tools: TOOLS,
    });

    expect(tel.sampleCount).toBe(4);
    expect(tel.noLock).toBe(1);
    expect(tel.fixCount).toBe(2);
  });

  it('rejects videos without any telemetry source', async () => {
    mocks.ffprobeJson.mockResolvedValue({ streams: [] });
    const dir = tmpDir();
    const video = path.join(dir, 'naked.mp4');
    fs.writeFileSync(video, '');
    await expect(
      loadTelemetry(video, { frames: 2, fpsValue: 30, durationSec: 1, tools: TOOLS }),
    ).rejects.toThrow(/no telemetry found/);
  });

  it('surfaces cam meta tool failures instead of claiming no telemetry', async () => {
    const failure = new Error('spawn ffprobe ENOENT');
    mocks.ffprobeJson.mockRejectedValue(failure);
    const dir = tmpDir();
    const video = path.join(dir, 'unreadable.mp4');
    fs.writeFileSync(video, '');
    const err = await loadTelemetry(video, { frames: 2, fpsValue: 30, durationSec: 1, tools: TOOLS }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toBe('ffprobe failed while probing the cam meta stream');
    expect(err?.cause).toBe(failure);
  });
});

describe('telemetry source selection', () => {
  type CamShape = 'none' | 'fixes' | 'no-fixes-packets' | 'no-fixes-scan';

  interface SelectionCase {
    name: string;
    cam: CamShape;
    srt: boolean;
  }

  const NO_FIX_PAIRS_ERROR =
    'no telemetry found: the CAM meta (DVTM) stream has no GPS fix pairs; ' +
    'the .SRT sidecar is only consulted when no CAM meta stream is present';

  const NO_SOURCE_ERROR =
    'no telemetry found: no CAM meta (DVTM) stream and no .SRT sidecar';

  function mockCamMetaStream(parts: Buffer[]): void {
    mocks.ffprobeJson
      .mockResolvedValueOnce({
        streams: [{ index: 3, tags: { handler_name: 'CAM meta' } }],
      })
      .mockResolvedValueOnce({
        packets: parts.map((part, i) => ({
          pts_time: String(i / 30),
          size: String(part.length),
        })),
      });
    mocks.execFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: (e: Error | null) => void) => {
        fs.writeFileSync(args[args.length - 1], Buffer.concat(parts));
        cb(null);
      },
    );
  }

  // A listing that cannot match the dump forces the GPS byte-scan path.
  function mockUnusableCamMetaStream(dump: Buffer): void {
    mocks.ffprobeJson
      .mockResolvedValueOnce({
        streams: [{ index: 3, tags: { handler_name: 'CAM meta' } }],
      })
      .mockResolvedValueOnce({ packets: [{ pts_time: '0', size: '5' }] });
    mocks.execFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: (e: Error | null) => void) => {
        fs.writeFileSync(args[args.length - 1], dump);
        cb(null);
      },
    );
  }

  const RICH_META: PacketMeta = {
    relAltMm: 3300,
    absAltM: 313.227,
    gpsAltMm: 313227,
    iso: 340,
    whiteBalanceCctK: 4435,
    attitude: { pitch: 12, roll: -3, yaw: 900 },
    gimbal: {
      pitch: -455,
      roll: 0,
      yaw: 902,
      device: {
        id: 0,
        type: 1,
        subType: 3,
        name: 'gimbal',
        frequency: 200,
        timestampMs: 1000,
      },
    },
    clip: { protoFile: 'dvtm_NEO2.proto', productProtoVersion: 'v02.00.07' },
  };

  function setupSources(cam: CamShape, srt: boolean, video: string): void {
    if (srt) writeSrt(video, SRT_SAMPLE);
    switch (cam) {
      case 'none':
        mocks.ffprobeJson.mockResolvedValue({ streams: [] });
        break;
      case 'fixes':
        mockCamMetaStream([
          productMetaPacket(46.7, 14.4, RICH_META),
          productMetaPacket(46.71, 14.41),
        ]);
        break;
      case 'no-fixes-packets':
        mockCamMetaStream([productMetaPacket(0, 0), productMetaPacket(0, 0)]);
        break;
      case 'no-fixes-scan':
        mockUnusableCamMetaStream(Buffer.alloc(64, 0x20));
        break;
    }
  }

  const RESOLVING_CASES: Array<
    SelectionCase & {
      source: 'srt' | 'cammeta';
      method: 'srt-cues' | 'dvtm-packets';
      check: (loaded: LoadedTelemetry) => void;
    }
  > = [
    {
      name: 'only an .SRT sidecar: the sidecar is used',
      cam: 'none',
      srt: true,
      source: 'srt',
      method: 'srt-cues',
      check: (loaded) => {
        expect(loaded.telemetry.frames[0].fix?.lat).toBeCloseTo(46.61307, 6);
        expect(loaded.telemetry.headingMode).toBe('cog');
        expect(loaded.frameValues).toHaveLength(3);
        expect(loaded.protoFile).toBeNull();
        expect(loaded.gimbalDevice).toBeNull();
      },
    },
    {
      name: 'only a CAM meta (DVTM) stream: cammeta is used',
      cam: 'fixes',
      srt: false,
      source: 'cammeta',
      method: 'dvtm-packets',
      check: (loaded) => {
        expect(loaded.telemetry.frames[0].fix?.lat).toBeCloseTo(46.7, 6);
        expect(loaded.telemetry.headingMode).toBe('yaw');
        expect(loaded.frameValues).toHaveLength(2);
        expect(loaded.frameValues[0].gimbalDeviceTimestampMs).toBe(1000);
        expect(loaded.frameValues[0].yawDeg).toBeCloseTo(90, 6);
        expect(loaded.protoFile).toBe('dvtm_NEO2.proto v02.00.07');
        expect(loaded.gimbalDevice?.name).toBe('gimbal');
      },
    },
    {
      name: 'both sources: the CAM meta (DVTM) stream wins',
      cam: 'fixes',
      srt: true,
      source: 'cammeta',
      method: 'dvtm-packets',
      check: (loaded) => {
        expect(loaded.telemetry.frames[0].fix?.lat).toBeCloseTo(46.7, 6);
        expect(loaded.telemetry.frames[0].fix?.lon).toBeCloseTo(14.4, 6);
        expect(loaded.telemetry.headingMode).toBe('yaw');
        expect(loaded.frameValues).toHaveLength(2);
        expect(loaded.protoFile).toBe('dvtm_NEO2.proto v02.00.07');
        expect(loaded.gimbalDevice?.name).toBe('gimbal');
      },
    },
  ];

  it.for(RESOLVING_CASES)(
    '$name',
    async ({ cam, srt, source, method, check }) => {
      const dir = tmpDir();
      const video = path.join(dir, 'clip.mp4');
      fs.writeFileSync(video, '');
      setupSources(cam, srt, video);

      const loaded = await loadTelemetry(video, {
        frames: 3,
        fpsValue: 30,
        durationSec: 0.1,
        tools: TOOLS,
      });
      expect(loaded.telemetry.source).toBe(source);
      expect(loaded.telemetry.method).toBe(method);
      check(loaded);
    },
  );

  const FAILING_CASES: Array<SelectionCase & { error: string }> = [
    {
      name: 'neither source: a clear error',
      cam: 'none',
      srt: false,
      error: NO_SOURCE_ERROR,
    },
    {
      name: 'CAM meta without GPS fix pairs (packet decode): fails instead of falling back to .SRT',
      cam: 'no-fixes-packets',
      srt: true,
      error: NO_FIX_PAIRS_ERROR,
    },
    {
      name: 'CAM meta without GPS fix pairs (byte scan): fails instead of falling back to .SRT',
      cam: 'no-fixes-scan',
      srt: true,
      error: NO_FIX_PAIRS_ERROR,
    },
  ];

  it.for(FAILING_CASES)('$name', async ({ cam, srt, error }) => {
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    fs.writeFileSync(video, '');
    setupSources(cam, srt, video);

    const err = await loadTelemetry(video, {
      frames: 3,
      fpsValue: 30,
      durationSec: 0.1,
      tools: TOOLS,
    }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toBe(error);
  });
});

describe('cross-source fix classification', () => {
  function srtCueText(coords: Array<[number, number]>): string {
    return coords
      .map(([lat, lon], i) =>
        [
          `${i + 1}`,
          `00:00:00,${String(i * 33).padStart(3, '0')} --> ` +
            `00:00:00,${String(i * 33 + 33).padStart(3, '0')}`,
          `[latitude: ${lat}] [longitude: ${lon}]`,
        ].join('\n'),
      )
      .join('\n');
  }

  function srtCounts(coords: Array<[number, number]>): {
    fixes: number;
    noLock: number;
  } {
    const r = parseSrtText(srtCueText(coords));
    return { fixes: r.cues.filter((c) => c.fix !== null).length, noLock: r.noLock };
  }

  function camCounts(coords: Array<[number, number]>): {
    fixes: number;
    noLock: number;
  } {
    const parts = coords.map(([lat, lon]) => productMetaPacket(lat, lon));
    const packets: PacketInfo[] = [];
    let tSec = 0;
    for (const part of parts) {
      packets.push({ tSec, size: part.length });
      tSec += 1 / 30;
    }
    const { samples, noLock } = decodePacketSamples(
      Buffer.concat(parts),
      packets,
      false,
    );
    return { fixes: samples.length, noLock };
  }

  const CASES: Array<{
    name: string;
    coords: Array<[number, number]>;
    fixes: number;
    noLock: number;
  }> = [
    {
      name: 'regular fixes',
      coords: [[46.6, 14.3], [46.61, 14.31]],
      fixes: 2,
      noLock: 0,
    },
    {
      name: 'the 0/0 placeholder',
      coords: [[0, 0], [46.6, 14.3], [46.61, 14.31]],
      fixes: 2,
      noLock: 1,
    },
    {
      name: 'near-null-island fixes (the disagreement regression)',
      coords: [[0.1, 0.1], [0.5, 0.5], [46.6, 14.3]],
      fixes: 3,
      noLock: 0,
    },
    {
      name: 'equator and prime meridian crossings',
      coords: [[0.2, 10.2], [10.2, 0.2], [0, 0]],
      fixes: 2,
      noLock: 1,
    },
    {
      name: 'out-of-range coordinates',
      coords: [[91, 0], [0, 181], [46.6, 14.3]],
      fixes: 1,
      noLock: 2,
    },
    {
      name: 'mixed fixes, placeholders and boundaries',
      coords: [[0, 0], [0.1, 0.1], [0.5, 0.5], [0, 0], [46.6, 14.3], [46.61, 14.31]],
      fixes: 4,
      noLock: 2,
    },
  ];

  it.for(CASES)('$name: SRT and CAM meta agree', ({ coords, fixes, noLock }) => {
    expect(srtCounts(coords)).toEqual({ fixes, noLock });
    expect(camCounts(coords)).toEqual({ fixes, noLock });
  });

  it('counts near-null-island fixes through loadTelemetry', async () => {
    mocks.ffprobeJson.mockResolvedValue({ streams: [] });
    const dir = tmpDir();
    const video = path.join(dir, 'coast.mp4');
    fs.writeFileSync(video, '');
    writeSrt(video, srtCueText([[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]]));

    const { telemetry: tel } = await loadTelemetry(video, {
      frames: 3,
      fpsValue: 30,
      durationSec: 0.1,
      tools: TOOLS,
    });
    expect(tel.fixCount).toBe(3);
    expect(tel.noLock).toBe(0);
  });
});

describe('telemetry JSON export values', () => {
  it('maps SRT cues to frame rows without attitude or device timestamps', async () => {
    mocks.ffprobeJson.mockResolvedValue({ streams: [] });
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    fs.writeFileSync(video, '');
    writeSrt(video, SRT_SAMPLE);

    const loaded = await loadTelemetry(video, {
      frames: 3,
      fpsValue: 30,
      durationSec: 0.1,
      tools: TOOLS,
    });
    expect(loaded.telemetry.headingMode).toBe('cog');
    expect(loaded.protoFile).toBeNull();
    expect(loaded.gimbalDevice).toBeNull();
    expect(loaded.frameValues).toHaveLength(3);
    expect(loaded.frameValues[0]).toEqual({
      lat: 46.61307,
      lng: 14.262388,
      altAbs: 313.227,
      altRel: 3.3,
      iso: 340,
      shutterTime: 0.0025,
      whiteBalanceCctK: 4435,
      fNumber: 2.2,
    });
    expect(loaded.frameValues[1].lat).toBeNull();
    expect(loaded.frameValues[1].lng).toBeNull();
    expect(loaded.frameValues[1].iso).toBe(340);
    expect(loaded.frameValues[1].shutterTime).toBeNull();
    expect(loaded.frameValues[1].altRel).toBeCloseTo(3.4, 6);
  });

  it('keeps the pipeline on fix-bearing samples while rows cover every frame', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    fs.writeFileSync(video, '');

    const parts = [
      productMetaPacket(46.6, 14.3),
      productMetaPacket(0, 0),
      productMetaPacket(46.61, 14.31),
    ];
    const dump = Buffer.concat(parts);
    mocks.ffprobeJson
      .mockResolvedValueOnce({
        streams: [{ index: 3, tags: { handler_name: 'CAM meta' } }],
      })
      .mockResolvedValueOnce({
        packets: parts.map((part, i) => ({
          pts_time: String(i / 30),
          size: String(part.length),
        })),
      });
    mocks.execFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: (e: Error | null) => void) => {
        fs.writeFileSync(args[args.length - 1], dump);
        cb(null);
      },
    );

    const loaded = await loadTelemetry(video, {
      frames: 3,
      fpsValue: 30,
      durationSec: 0.1,
      tools: TOOLS,
    });
    expect(loaded.telemetry.sampleCount).toBe(2);
    expect(loaded.telemetry.fixCount).toBe(2);
    expect(loaded.telemetry.noLock).toBe(1);
    expect(loaded.frameValues).toHaveLength(3);
    expect(loaded.frameValues[0].lat).toBeCloseTo(46.6, 6);
    expect(loaded.frameValues[1].lat).toBeNull();
    expect(loaded.frameValues[2].lat).toBeCloseTo(46.61, 6);
  });
});
