import fs from 'node:fs';
import path from 'node:path';

import type { McpServer as SdkMcpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { analyzeArchiveSharpness, exportArchiveSharpnessNdjson, getArchiveSharpness } from 'drone-path-archive/sharpness';
import type * as archiveSharpnessModule from 'drone-path-archive/sharpness';
import { extractKeyframes } from 'drone-path-core/keyframes';
import type { ExtractedKeyframe } from 'drone-path-core/keyframes';
import type * as keyframesModule from 'drone-path-core/keyframes';
import { runBatch } from 'drone-path-engine/pipeline';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

import { registerMcpTools } from '../src/mcp-tools.js';

vi.mock('drone-path-archive/sharpness', async (importOriginal) => {
  const actual = await importOriginal<typeof archiveSharpnessModule>();
  return {
    ...actual,
    analyzeArchiveSharpness: vi.fn(),
    getArchiveSharpness: vi.fn(),
    exportArchiveSharpnessNdjson: vi.fn(),
  };
});

vi.mock('drone-path-core/keyframes', async (importOriginal) => {
  const actual = await importOriginal<typeof keyframesModule>();
  return {
    ...actual,
    extractKeyframes: vi.fn(),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  cleanupTmpDirs();
});

type RegisteredTool = {
  config: { description: string; inputSchema: { parse: (val: unknown) => unknown } };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }>;
};

function createToolRegistry(allowedRoot: string): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    registerTool(
      name: string,
      config: RegisteredTool['config'],
      handler: RegisteredTool['handler'],
    ) {
      tools.set(name, { config, handler });
    },
  } as unknown as SdkMcpServer;

  registerMcpTools(fakeServer, {
    archiveDb: path.join(allowedRoot, 'archive.sqlite'),
    allowedRoots: [allowedRoot],
    getTools: async () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }),
    runBatch,
    log: () => {},
  });
  return tools;
}

describe('clip_extract_keyframes MCP tool', () => {
  it('omits sharpness by default and forwards sharpness: true when requested', async () => {
    const root = tmpDir();
    const videoPath = path.join(root, 'clip.mp4');
    fs.writeFileSync(videoPath, 'mp4');
    const tools = createToolRegistry(root);
    const tool = tools.get('clip_extract_keyframes');
    expect(tool).toBeDefined();

    const baseFrame: ExtractedKeyframe = {
      path: path.join(root, 'clip_f30_1000ms.jpg'),
      tSec: 1,
      frame: 30,
      width: 640,
      height: 360,
      telemetry: null,
    };
    const scoredFrame: ExtractedKeyframe = {
      ...baseFrame,
      sharpness: {
        sharpnessScore: 66.67,
        edgeCoverage: 0.05,
        analyzer: { method: 'ffmpeg-blurdetect', version: '1' },
      },
    };

    const extractSpy = vi.mocked(extractKeyframes);
    extractSpy.mockResolvedValueOnce([baseFrame]).mockResolvedValueOnce([scoredFrame]);

    const withoutSharpness = await tool!.handler({ videoPath, at: '1.0' });
    expect(extractSpy).toHaveBeenNthCalledWith(
      1,
      fs.realpathSync(videoPath),
      expect.objectContaining({
        at: [{ kind: 'time', tSec: 1 }],
        sharpness: undefined,
      }),
    );
    expect(withoutSharpness.structuredContent).toEqual({
      videoPath: fs.realpathSync(videoPath),
      outDir: fs.realpathSync(root),
      count: 1,
      keyframes: [baseFrame],
    });

    const withSharpness = await tool!.handler({
      videoPath,
      at: ['1.0'],
      maxWidth: 640,
      sharpness: true,
    });
    expect(extractSpy).toHaveBeenNthCalledWith(
      2,
      fs.realpathSync(videoPath),
      expect.objectContaining({
        at: [{ kind: 'time', tSec: 1 }],
        maxWidth: 640,
        sharpness: true,
      }),
    );
    expect(withSharpness.structuredContent).toEqual({
      videoPath: fs.realpathSync(videoPath),
      outDir: fs.realpathSync(root),
      count: 1,
      keyframes: [scoredFrame],
    });
  });

  it('rejects non-boolean sharpness arguments in inputSchema', () => {
    const root = tmpDir();
    const tools = createToolRegistry(root);
    const schema = tools.get('clip_extract_keyframes')!.config.inputSchema;
    expect(() =>
      schema.parse({ videoPath: path.join(root, 'clip.mp4'), at: '1.0', sharpness: 'yes' }),
    ).toThrow();
  });
});

describe('archive sharpness MCP tools', () => {
  it('routes archive_analyze_sharpness inside allowed roots and rejects archiveDb as videoPath', async () => {
    const root = tmpDir();
    const realRoot = fs.realpathSync(root);
    const videoPath = path.join(root, 'clip.mp4');
    fs.writeFileSync(videoPath, 'mp4');
    const archiveDb = path.join(realRoot, 'archive.sqlite');
    const tools = createToolRegistry(root);
    const analyzeTool = tools.get('archive_analyze_sharpness')!;

    vi.mocked(analyzeArchiveSharpness).mockResolvedValue({
      clip: {
        path: path.join(realRoot, 'clip.mp4'),
        status: 'ok',
        availability: 'online',
        size: 3,
        mtimeMs: 1,
        video: null,
        cameraCreationTime: null,
        telemetry: null,
        bbox: null,
        track: [],
        error: null,
      },
      clipKey: path.join(realRoot, 'clip.mp4').toLowerCase(),
      cached: false,
      run: {
        runId: 1,
        clipKey: path.join(realRoot, 'clip.mp4').toLowerCase(),
        fingerprintKey: '{"size":3,"mtimeMs":1}',
        method: 'ffmpeg-blurdetect',
        version: '1',
        settings: { mode: 'sampled', stride: 30, analysisWidth: 640, minEdgeCoverage: 0.002 },
        sampleCount: 3,
        analyzedAtMs: 1000,
      },
    });

    const ok = await analyzeTool.handler({ videoPath, mode: 'sampled', force: true });
    expect(ok.isError).toBeUndefined();
    expect(analyzeArchiveSharpness).toHaveBeenCalledWith(
      archiveDb,
      fs.realpathSync(videoPath),
      expect.objectContaining({
        mode: 'sampled',
        force: true,
        assertAllowedPath: expect.any(Function),
      }),
    );
    const passedOpts = vi.mocked(analyzeArchiveSharpness).mock.calls[0]?.[2];
    expect(() => passedOpts?.assertAllowedPath?.(path.join(root, '..', 'outside.SRT'))).toThrow(
      'path is outside allowed roots',
    );
    expect(ok.structuredContent).toEqual({
      clipPath: 'clip.mp4',
      availability: 'online',
      cached: false,
      run: {
        runId: 1,
        clipPath: 'clip.mp4',
        fingerprintKey: '{"size":3,"mtimeMs":1}',
        method: 'ffmpeg-blurdetect',
        version: '1',
        settings: { mode: 'sampled', stride: 30, analysisWidth: 640, minEdgeCoverage: 0.002 },
        sampleCount: 3,
        analyzedAtMs: 1000,
      },
    });
    expect(JSON.stringify(ok.structuredContent)).not.toContain(realRoot);

    const dbReject = await analyzeTool.handler({ videoPath: archiveDb });
    expect(dbReject.isError).toBe(true);
    expect(dbReject.content[0]?.text).toMatch(/archive database/);
  });

  it('routes archive_get_sharpness for bounded queries and enforces overwrite protection on outPath', async () => {
    const root = tmpDir();
    const realRoot = fs.realpathSync(root);
    const videoPath = path.join(root, 'offline.mp4');
    const outPath = path.join(root, 'timeline.ndjson');
    const archiveDb = path.join(realRoot, 'archive.sqlite');
    const tools = createToolRegistry(root);
    const getTool = tools.get('archive_get_sharpness')!;

    const timeline = {
      clipPath: path.join(realRoot, 'offline.mp4'),
      clipKey: path.join(realRoot, 'offline.mp4').toLowerCase(),
      availability: 'offline' as const,
      analyzed: true,
      run: {
        runId: 1,
        clipKey: path.join(realRoot, 'offline.mp4').toLowerCase(),
        fingerprintKey: '{"size":3,"mtimeMs":1}',
        method: 'ffmpeg-blurdetect',
        version: '1',
        settings: { mode: 'sampled' as const, stride: 30, analysisWidth: 640, minEdgeCoverage: 0.002 },
        sampleCount: 2,
        analyzedAtMs: 1000,
      },
      totalSamples: 2,
      limit: 50,
      offset: 0,
      truncated: false,
      samples: [{ frameIndex: 0, tSec: 0, sharpnessScore: 50, edgeCoverage: 0.01 }],
    };
    vi.mocked(getArchiveSharpness).mockReturnValue(timeline);

    const queried = await getTool.handler({ videoPath, startSec: 0, endSec: 2, limit: 50 });
    expect(queried.isError).toBeUndefined();
    expect(queried.structuredContent).toEqual({
      clipPath: 'offline.mp4',
      availability: 'offline',
      analyzed: true,
      run: {
        runId: 1,
        clipPath: 'offline.mp4',
        fingerprintKey: '{"size":3,"mtimeMs":1}',
        method: 'ffmpeg-blurdetect',
        version: '1',
        settings: { mode: 'sampled', stride: 30, analysisWidth: 640, minEdgeCoverage: 0.002 },
        sampleCount: 2,
        analyzedAtMs: 1000,
      },
      totalSamples: 2,
      limit: 50,
      offset: 0,
      truncated: false,
      samples: [{ frameIndex: 0, tSec: 0, sharpnessScore: 50, edgeCoverage: 0.01 }],
    });
    expect(JSON.stringify(queried.structuredContent)).not.toContain(realRoot);
    expect(getArchiveSharpness).toHaveBeenCalledWith(
      archiveDb,
      path.join(realRoot, 'offline.mp4'),
      { mode: undefined, startSec: 0, endSec: 2, limit: 50, offset: undefined },
    );

    const dbOutReject = await getTool.handler({ videoPath, outPath: archiveDb });
    expect(dbOutReject.isError).toBe(true);
    expect(dbOutReject.content[0]?.text).toMatch(/archive database/);

    fs.writeFileSync(outPath, 'existing');
    const overwriteBlocked = await getTool.handler({ videoPath, outPath });
    expect(overwriteBlocked.isError).toBe(true);
    expect(overwriteBlocked.content[0]?.text).toMatch(/refusing to overwrite/);

    // Even with DRONE_PATH_MCP_ALLOW_OVERWRITE=1, MCP archive_get_sharpness stays create-only.
    vi.stubEnv('DRONE_PATH_MCP_ALLOW_OVERWRITE', '1');
    const overwriteStillBlocked = await getTool.handler({ videoPath, outPath });
    expect(overwriteStillBlocked.isError).toBe(true);
    expect(overwriteStillBlocked.content[0]?.text).toMatch(/refusing to overwrite/);

    const newOutPath = path.join(root, 'nested', 'timeline-new.ndjson');
    vi.mocked(exportArchiveSharpnessNdjson).mockReturnValue({
      clipPath: timeline.clipPath,
      clipKey: timeline.clipKey,
      availability: 'offline',
      run: timeline.run,
      count: 2,
      ndjson: '{"frameIndex":0}\n{"frameIndex":30}\n',
    });
    const exportOk = await getTool.handler({ videoPath, outPath: newOutPath });
    expect(exportOk.isError).toBeUndefined();
    expect(exportArchiveSharpnessNdjson).toHaveBeenLastCalledWith(
      archiveDb,
      path.join(realRoot, 'offline.mp4'),
      expect.objectContaining({ outPath: path.join(realRoot, 'nested', 'timeline-new.ndjson'), overwrite: false }),
    );
    expect(exportOk.structuredContent).toMatchObject({
      clipPath: 'offline.mp4',
      outPath: 'nested/timeline-new.ndjson',
      format: 'ndjson',
      count: 2,
    });
    expect(JSON.stringify(exportOk.structuredContent)).not.toContain(realRoot);
  });
});
