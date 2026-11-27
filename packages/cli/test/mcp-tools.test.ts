import fs from 'node:fs';
import path from 'node:path';

import type { McpServer as SdkMcpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractKeyframes } from 'drone-path-core/keyframes';
import type { ExtractedKeyframe } from 'drone-path-core/keyframes';
import type * as keyframesModule from 'drone-path-core/keyframes';
import { runBatch } from 'drone-path-engine/pipeline';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

import { registerMcpTools } from '../src/mcp-tools.js';

vi.mock('drone-path-core/keyframes', async (importOriginal) => {
  const actual = await importOriginal<typeof keyframesModule>();
  return {
    ...actual,
    extractKeyframes: vi.fn(),
  };
});

afterEach(() => {
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
