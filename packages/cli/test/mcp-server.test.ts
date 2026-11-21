import type * as childProcessModule from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

const probeData = vi.hoisted(() => ({
  creationTime: '2026-05-25T09:18:11.000000Z',
  durationSec: 6,
  frames: 180,
  width: 1280,
  height: 720,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcessModule>();
  const runFake = (command: string, args: readonly string[]): { stdout: string; stderr: string } => {
    if (args.includes('-version')) {
      return { stdout: `${command} version 7.1`, stderr: '' };
    }
    if (command.toLowerCase().includes('ffprobe')) {
      const json = JSON.stringify({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            r_frame_rate: '30/1',
            avg_frame_rate: '30/1',
            nb_frames: String(probeData.frames),
            width: probeData.width,
            height: probeData.height,
          },
        ],
        format: {
          duration: String(probeData.durationSec),
          tags: { creation_time: probeData.creationTime },
        },
      });
      return { stdout: json, stderr: '' };
    }
    if (command.toLowerCase().includes('ffmpeg')) {
      const outPath = args[args.length - 1];
      if (outPath) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      }
      return { stdout: '', stderr: '' };
    }
    throw new Error(`unexpected command in test: ${command}`);
  };
  const execFile = Object.assign(
    (
      command: string,
      argsOrOpts: readonly string[] | Record<string, unknown>,
      optsOrCb?:
        | Record<string, unknown>
        | ((err: Error | null, stdout?: string, stderr?: string) => void),
      maybeCb?: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      const args = Array.isArray(argsOrOpts) ? argsOrOpts : [];
      const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
      if (!cb) return;
      try {
        const res = runFake(command, args);
        cb(null, res.stdout, res.stderr);
      } catch (err) {
        cb(err as Error);
      }
    },
    {
      [promisify.custom]: async (command: string, args: readonly string[] = []) =>
        runFake(command, args),
    },
  );
  return { ...actual, execFile };
});

import { main } from '../src/cli.js';
import { createMcpServer } from '../src/mcp-server.js';
import { VERSION } from '../src/version.js';

const TEST_PROTOCOL_VERSION = '2024-11-05';

afterEach(() => {
  cleanupTmpDirs();
  vi.restoreAllMocks();
});

const SAMPLE_SRT_FLIGHT = `1
00:00:00,000 --> 00:00:01,000
<font size="28">FrameCnt: 1, DiffTime: 1000ms
2026-05-25 09:18:11.000
[iso: 100] [shutter: 1/400.0] [fnum: 2.8] [ct: 5500] [latitude: 46.613000] [longitude: 14.262000] [rel_alt: 10.000 abs_alt: 310.000]</font>

2
00:00:01,000 --> 00:00:02,000
<font size="28">FrameCnt: 31, DiffTime: 1000ms
2026-05-25 09:18:12.000
[iso: 100] [shutter: 1/400.0] [fnum: 2.8] [ct: 5500] [latitude: 46.613045] [longitude: 14.262000] [rel_alt: 10.000 abs_alt: 310.000]</font>

3
00:00:02,000 --> 00:00:03,000
<font size="28">FrameCnt: 61, DiffTime: 1000ms
2026-05-25 09:18:13.000
[iso: 100] [shutter: 1/400.0] [fnum: 2.8] [ct: 5500] [latitude: 46.613090] [longitude: 14.262000] [rel_alt: 10.000 abs_alt: 310.000]</font>

4
00:00:03,000 --> 00:00:04,000
<font size="28">FrameCnt: 91, DiffTime: 1000ms
2026-05-25 09:18:14.000
[iso: 100] [shutter: 1/400.0] [fnum: 2.8] [ct: 5500] [latitude: 46.613135] [longitude: 14.262000] [rel_alt: 10.000 abs_alt: 310.000]</font>

5
00:00:04,000 --> 00:00:05,000
<font size="28">FrameCnt: 121, DiffTime: 1000ms
2026-05-25 09:18:15.000
[iso: 100] [shutter: 1/400.0] [fnum: 2.8] [ct: 5500] [latitude: 46.613180] [longitude: 14.262000] [rel_alt: 10.000 abs_alt: 310.000]</font>
`;

interface JsonRpcReply {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolCallEnvelope {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function createHarness(options: Parameters<typeof createMcpServer>[0] = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const logs: string[] = [];
  const rawLines: string[] = [];
  const pending = new Map<string | number, (reply: JsonRpcReply) => void>();
  let buffer = '';

  output.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      rawLines.push(line);
      const parsed = JSON.parse(line) as JsonRpcReply;
      if (parsed.id !== null && parsed.id !== undefined) {
        const resolve = pending.get(parsed.id);
        if (resolve) {
          pending.delete(parsed.id);
          resolve(parsed);
        }
      }
    }
  });

  const server = createMcpServer({
    input,
    output,
    log: (msg) => logs.push(msg),
    tools: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
    ...options,
  });

  const running = server.start();
  let nextId = 1;

  async function request(method: string, params?: Record<string, unknown>): Promise<JsonRpcReply> {
    const id = nextId++;
    const replyPromise = new Promise<JsonRpcReply>((resolve) => {
      pending.set(id, resolve);
    });
    const payload =
      params !== undefined
        ? { jsonrpc: '2.0', id, method, params }
        : { jsonrpc: '2.0', id, method };
    input.write(`${JSON.stringify(payload)}\n`);
    return replyPromise;
  }

  function notify(method: string, params?: Record<string, unknown>): void {
    const payload =
      params !== undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', method };
    input.write(`${JSON.stringify(payload)}\n`);
  }

  async function initialize(): Promise<JsonRpcReply> {
    const res = await request('initialize', {
      protocolVersion: TEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    notify('notifications/initialized');
    return res;
  }

  async function callTool<T = unknown>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ envelope: ToolCallEnvelope; parsed: T | null }> {
    const res = await request('tools/call', { name, arguments: args });
    expect(res.error).toBeUndefined();
    const envelope = res.result as ToolCallEnvelope;
    const text = envelope.content[0]?.text ?? '';
    return {
      envelope,
      parsed: envelope.isError ? null : (JSON.parse(text) as T),
    };
  }

  async function shutdown(): Promise<void> {
    input.end();
    await running;
  }

  return { server, request, notify, initialize, callTool, shutdown, logs, rawLines };
}

describe('MCP stdio protocol', () => {
  it('handles initialize, notifications, ping, tools/list, and protocol errors over stdio streams', async () => {
    const root = tmpDir();
    const db = path.join(tmpDir(), 'archive.sqlite');
    const h = createHarness({ allowedRoots: [root], archiveDb: db });

    const init = await h.initialize();
    expect(init.result).toMatchObject({
      protocolVersion: TEST_PROTOCOL_VERSION,
      capabilities: { tools: expect.any(Object) },
      serverInfo: { name: 'drone-path', version: VERSION },
    });

    const ping = await h.request('ping');
    expect(ping.result).toEqual({});

    const list = await h.request('tools/list');
    const toolsResult = list.result as {
      tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    };
    expect(toolsResult.tools.map((t) => t.name)).toEqual([
      'archive_scan',
      'archive_list_clips',
      'archive_list_flights',
      'archive_find_at_point',
      'archive_list_segments',
      'clip_get_telemetry',
      'clip_extract_keyframes',
      'export_markers',
      'render_map_video',
    ]);
    for (const tool of toolsResult.tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }

    const unknownMethod = await h.request('unknown/method');
    expect(unknownMethod.error?.code).toBe(-32601);

    const unknownTool = await h.request('tools/call', {
      name: 'no_such_tool',
      arguments: {},
    });
    expect(
      unknownTool.error?.code === -32602 || (unknownTool.result as ToolCallEnvelope)?.isError === true,
    ).toBe(true);

    const invalidArgs = await h.callTool('archive_find_at_point', { lat: 999, lon: 0 });
    expect(invalidArgs.envelope.isError).toBe(true);

    await h.shutdown();
    expect(h.logs).toEqual([]);
  });
});

describe('MCP path boundary enforcement', () => {
  it('rejects traversal, outside-root, and symlink/junction paths across every file/folder tool', async () => {
    const parent = tmpDir();
    const allowed = path.join(parent, 'allowed');
    const outside = path.join(parent, 'outside');
    const dbDir = tmpDir();
    const archiveDb = path.join(dbDir, 'archive.sqlite');
    fs.mkdirSync(allowed);
    fs.mkdirSync(outside);

    const allowedClip = path.join(allowed, 'DJI_0001.MP4');
    const outsideClip = path.join(outside, 'secret.mp4');
    fs.writeFileSync(allowedClip, 'mp4');
    fs.writeFileSync(outsideClip, 'mp4');

    const linkDir = path.join(allowed, 'escape-dir');
    fs.symlinkSync(outside, linkDir, process.platform === 'win32' ? 'junction' : 'dir');

    const h = createHarness({ allowedRoots: [allowed], archiveDb });
    await h.initialize();

    const traversal = path.join(allowed, '..', 'outside', 'secret.mp4');
    const linkedOutside = path.join(linkDir, 'secret.mp4');

    const checks: Array<[string, Record<string, unknown>, RegExp]> = [
      ['archive_scan', { dirs: [outside] }, /path is outside allowed roots/],
      ['archive_scan', { dirs: [linkDir] }, /path is outside allowed roots/],
      ['clip_get_telemetry', { videoPath: traversal }, /path is outside allowed roots/],
      ['clip_get_telemetry', { videoPath: linkedOutside }, /path is outside allowed roots/],
      [
        'clip_extract_keyframes',
        { videoPath: outsideClip, at: '1.0' },
        /path is outside allowed roots/,
      ],
      [
        'clip_extract_keyframes',
        { videoPath: allowedClip, at: '1.0', outDir: linkDir },
        /path is outside allowed roots/,
      ],
      [
        'export_markers',
        { outputPath: path.join(outside, 'markers.csv'), ranges: [] },
        /path is outside allowed roots/,
      ],
      [
        'export_markers',
        {
          outputPath: path.join(allowed, 'markers.csv'),
          ranges: [
            {
              clipPath: linkedOutside,
              startSec: 0,
              endSec: 1,
              label: 'orbit',
              durationSec: 5,
              fps: 30,
            },
          ],
        },
        /path is outside allowed roots/,
      ],
      ['render_map_video', { inputs: [outsideClip] }, /path is outside allowed roots/],
      [
        'render_map_video',
        { inputs: [allowedClip], outDir: linkDir },
        /path is outside allowed roots/,
      ],
      [
        'render_map_video',
        {
          inputs: [allowedClip],
          outDir: path.join(allowed, 'out'),
          trackOut: path.join(outside, 't.gpx'),
        },
        /path is outside allowed roots/,
      ],
      [
        'render_map_video',
        {
          inputs: [allowedClip],
          outDir: path.join(allowed, 'out'),
          outSuffix: '/../../outside/pwn',
        },
        /outSuffix must not contain path separators/,
      ],
      [
        'render_map_video',
        {
          inputs: [allowedClip],
          outDir: path.join(allowed, 'out'),
          outSuffix: '..\\..\\outside\\pwn',
        },
        /outSuffix must not contain path separators/,
      ],
    ];

    for (const [toolName, args, pattern] of checks) {
      const { envelope } = await h.callTool(toolName, args);
      expect(envelope.isError, `${toolName} with ${JSON.stringify(args)}`).toBe(true);
      expect(envelope.content[0]?.text).toMatch(pattern);
    }

    await h.shutdown();

    // Guard against overwriting archiveDb when archiveDb resides inside an allowed root.
    const sameRootClip = path.join(dbDir, 'DJI_0001.MP4');
    fs.writeFileSync(sameRootClip, 'mp4');
    const sameRoot = createHarness({ allowedRoots: [dbDir], archiveDb });
    await sameRoot.initialize();
    const overwriteCheck = await sameRoot.callTool('export_markers', {
      outputPath: archiveDb,
      ranges: [],
    });
    expect(overwriteCheck.envelope.isError).toBe(true);
    expect(overwriteCheck.envelope.content[0]?.text).toMatch(/archive database/);

    const kfOverwriteCheck = await sameRoot.callTool('clip_extract_keyframes', {
      videoPath: sameRootClip,
      at: '1.0',
      outDir: archiveDb,
    });
    expect(kfOverwriteCheck.envelope.isError).toBe(true);
    expect(kfOverwriteCheck.envelope.content[0]?.text).toMatch(/archive database/);

    const renderOverwriteCheck = await sameRoot.callTool('render_map_video', {
      inputs: [sameRootClip],
      outDir: archiveDb,
    });
    expect(renderOverwriteCheck.envelope.isError).toBe(true);
    expect(renderOverwriteCheck.envelope.content[0]?.text).toMatch(/archive database/);
    await sameRoot.shutdown();
  });

  it('filters archive query results to clips inside allowed roots', async () => {
    const parent = tmpDir();
    const rootA = path.join(parent, 'rootA');
    const rootB = path.join(parent, 'rootB');
    fs.mkdirSync(rootA);
    fs.mkdirSync(rootB);

    fs.writeFileSync(path.join(rootA, 'DJI_0001.MP4'), 'mp4');
    fs.writeFileSync(path.join(rootA, 'DJI_0001.SRT'), SAMPLE_SRT_FLIGHT);
    fs.writeFileSync(path.join(rootB, 'DJI_0002.MP4'), 'mp4');
    fs.writeFileSync(path.join(rootB, 'DJI_0002.SRT'), SAMPLE_SRT_FLIGHT);

    const archiveDb = path.join(tmpDir(), 'shared.sqlite');

    // Index both roots first.
    const fullServer = createHarness({ allowedRoots: [rootA, rootB], archiveDb });
    await fullServer.initialize();
    const scanRes = await fullServer.callTool<{ count: number }>('archive_scan', {
      dirs: [rootA, rootB],
    });
    expect(scanRes.parsed?.count).toBe(2);
    await fullServer.shutdown();

    // Scoped server only allows rootA and must not leak rootB clips.
    const scopedServer = createHarness({ allowedRoots: [rootA], archiveDb });
    await scopedServer.initialize();
    const clips = await scopedServer.callTool<{ count: number; clips: Array<{ path: string }> }>(
      'archive_list_clips',
      {},
    );
    expect(clips.parsed?.count).toBe(1);
    expect(clips.parsed?.clips[0]?.path).toContain('DJI_0001.MP4');

    const flights = await scopedServer.callTool<{ count: number }>('archive_list_flights', {});
    expect(flights.parsed?.count).toBe(1);

    const near = await scopedServer.callTool<{ count: number }>('archive_find_at_point', {
      lat: 46.61309,
      lon: 14.262,
      radiusM: 50,
    });
    expect(near.parsed?.count).toBe(1);

    const segs = await scopedServer.callTool<{ count: number }>('archive_list_segments', {});
    expect(segs.parsed?.count).toBeGreaterThanOrEqual(1);
    await scopedServer.shutdown();
  });
});

describe('end-to-end offline MCP workflow', () => {
  it('completes scan -> find/segments -> telemetry -> keyframes -> export_markers -> render_map_video over stdio', async () => {
    const workspace = tmpDir();
    const footageDir = path.join(workspace, 'footage');
    const outDir = path.join(workspace, 'renders');
    const kfDir = path.join(workspace, 'keyframes');
    const archiveDb = path.join(tmpDir(), 'archive.sqlite');
    fs.mkdirSync(footageDir, { recursive: true });

    const videoPath = path.join(footageDir, 'DJI_0100.MP4');
    fs.writeFileSync(videoPath, 'fake-mp4-bytes');
    fs.writeFileSync(path.join(footageDir, 'DJI_0100.SRT'), SAMPLE_SRT_FLIGHT);

    const runBatchCalls: Array<{
      videos: string[];
      outDir: string | null;
      range?: { start: number; end: number };
    }> = [];
    const runBatchStub = vi.fn(async (videos, config, _log, emit, options) => {
      runBatchCalls.push({ videos, outDir: config.outDir, range: options?.range });
      for (const video of videos) {
        const out = path.join(config.outDir ?? path.dirname(video), 'DJI_0100_map.mp4');
        fs.writeFileSync(out, 'rendered-mp4');
        emit({
          video,
          out,
          status: 'ok' as const,
          elapsedSec: 1,
          frames: 31,
          fps: '30',
          frameRange: options?.range,
        });
      }
      return { ok: videos.length, skipped: 0, failed: 0 };
    });

    const h = createHarness({
      allowedRoots: [workspace],
      archiveDb,
      runBatch: runBatchStub,
    });
    await h.initialize();

    const csvPath = path.join(workspace, 'markers.csv');
    const fcpxmlPath = path.join(workspace, 'markers.fcpxml');
    const trackPath = path.join(workspace, 'DJI_0100.gpx');

    const scan = await h.callTool<{ count: number; records: Array<{ status: string }> }>(
      'archive_scan',
      { dirs: [footageDir], recurse: true },
    );
    expect(scan.parsed?.count).toBe(1);
    expect(scan.parsed?.records[0]?.status).toBe('ok');

    const near = await h.callTool<{ count: number; hits: Array<{ matchType: string }> }>(
      'archive_find_at_point',
      { lat: 46.61309, lon: 14.262, radiusM: 25 },
    );
    expect(near.parsed?.count).toBe(1);
    expect(near.parsed?.hits[0]?.matchType).toBe('track');

    const segs = await h.callTool<{
      count: number;
      segments: Array<{ type: string; smoothness: number }>;
    }>('archive_list_segments', { segmentType: 'smooth-glide', minSmoothness: 0.5 });
    expect(segs.parsed?.count).toBe(1);
    expect(segs.parsed?.segments[0]?.type).toBe('smooth-glide');
    expect(segs.parsed?.segments[0]?.smoothness).toBeGreaterThanOrEqual(0.5);

    const tel = await h.callTool<{
      status: string;
      segments: Array<{ type: string }>;
      samples: Array<{ tSec: number }>;
      totalTrackRecords: number;
    }>('clip_get_telemetry', { videoPath, maxSamples: 3 });
    expect(tel.parsed?.status).toBe('ok');
    expect(tel.parsed?.segments[0]?.type).toBe('smooth-glide');
    expect(tel.parsed?.totalTrackRecords).toBe(5);
    expect(tel.parsed?.samples).toHaveLength(3);

    const telOne = await h.callTool<{
      samples: Array<{ tSec: number }>;
    }>('clip_get_telemetry', { videoPath, maxSamples: 1 });
    expect(telOne.parsed?.samples).toHaveLength(1);
    expect(telOne.parsed?.samples[0]?.tSec).toBe(0);

    const keyframes = await h.callTool<{
      count: number;
      keyframes: Array<{ path: string; frame: number; width: number }>;
    }>('clip_extract_keyframes', {
      videoPath,
      at: ['1.0', 'f90'],
      maxWidth: 640,
      outDir: kfDir,
    });
    expect(keyframes.parsed?.count).toBe(2);
    expect(keyframes.parsed?.keyframes[0]?.frame).toBe(30);
    expect(keyframes.parsed?.keyframes[1]?.frame).toBe(90);
    expect(keyframes.parsed?.keyframes[0]?.width).toBe(640);
    expect(fs.existsSync(keyframes.parsed!.keyframes[0].path)).toBe(true);

    const csvExport = await h.callTool<{ outputPath: string; format: string; count: number }>(
      'export_markers',
      { outputPath: csvPath, filters: { segmentType: 'smooth-glide' } },
    );
    expect(csvExport.parsed).toEqual({
      outputPath: fs.realpathSync(csvPath),
      format: 'csv',
      count: 1,
    });
    expect(fs.readFileSync(csvPath, 'utf8')).toContain('smooth-glide');

    const fcpxmlExport = await h.callTool<{ outputPath: string; format: string; count: number }>(
      'export_markers',
      {
        outputPath: fcpxmlPath,
        ranges: [{ clipPath: videoPath, startSec: 0.5, endSec: 3.5, label: 'hero-glide' }],
      },
    );
    expect(fcpxmlExport.parsed).toEqual({
      outputPath: fs.realpathSync(fcpxmlPath),
      format: 'fcpxml',
      count: 1,
    });
    expect(fs.readFileSync(fcpxmlPath, 'utf8')).toContain('hero-glide');

    const render = await h.callTool<{ ok: number; skipped: number; failed: number }>(
      'render_map_video',
      {
        inputs: [videoPath],
        outDir,
        style: 'topo',
        hud: 'heading,alt,speed',
        camera: 'overview',
        trailColor: 'e63946',
        trackOut: trackPath,
        frameStart: 10,
        frameEnd: 40,
      },
    );
    expect(render.parsed).toMatchObject({ ok: 1, skipped: 0, failed: 0 });
    expect(runBatchCalls).toHaveLength(1);
    expect(runBatchCalls[0]?.range).toEqual({ start: 10, end: 40 });

    await h.shutdown();
  });
});

describe('drone-path mcp CLI entrypoint', () => {
  it('supports --help cleanly with exitCode 0', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    try {
      await main(['node', 'drone-path', 'mcp', '--help']);
      expect(process.exitCode).toBe(0);
      const output = stdout.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('drone-path mcp');
      expect(output).toContain('--allow-root');
      expect(output).toContain('--archive-db');
    } finally {
      process.exitCode = prevExit;
    }
  });

  it('parses --allow-root and --archive-db and exits cleanly on stdin EOF', async () => {
    const root = tmpDir();
    const db = path.join(tmpDir(), 'cli-mcp.sqlite');
    const fakeStdin = new PassThrough();
    const stdinSpy = vi
      .spyOn(process, 'stdin', 'get')
      .mockReturnValue(fakeStdin as unknown as typeof process.stdin);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const running = main([
      'node',
      'drone-path',
      'mcp',
      '--allow-root',
      root,
      '--archive-db',
      db,
    ]);
    fakeStdin.end();
    await running;

    expect(stdinSpy).toHaveBeenCalled();
    const errText = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(errText).toContain('mcp stdio server ready');
    expect(errText).toContain(fs.realpathSync(root));
  });
});
