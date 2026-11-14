import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildProgram, longFlagOf, parseCliArgs } from '../src/cli.js';
import { CONFIG_OPTIONS, DEFAULT_CONFIG, TELEMETRY_JSON_ALIAS } from '../src/config.js';
import { defaultTileCache, resolveConfig } from '../src/configfile.js';
import type * as ffmpegModule from '../src/ffmpeg.js';
import type * as recordingsModule from '../src/recordings.js';
import type * as pipelineModule from '../src/pipeline.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('buildProgram', () => {
  it('reports drone-path as the program name in help output', () => {
    const program = buildProgram();
    expect(program.name()).toBe('drone-path');
    expect(program.helpInformation()).toMatch(/Usage: drone-path\b/);
  });
});

describe('parseCliArgs', () => {
  it('forwards only the flags actually set (bare invocation adds nothing)', () => {
    const { inputs, cli } = parseCliArgs(['clip.mp4']);
    expect(inputs).toEqual(['clip.mp4']);
    expect(cli).toEqual({});
  });

  it('parses flags and multiple inputs', () => {
    const { inputs, cli, configPath } = parseCliArgs([
      'a.mp4',
      'folder',
      '--style', 'topo',
      '--width', '1024',
      '--height', '512',
      '--hud', 'heading,alt,speed',
      '--codec', 'h265',
      '--quality', 'low',
      '--preset', 'veryfast',
      '--skip-existing',
      '--recurse',
      '--json',
      '--config', 'my.json',
    ]);
    expect(inputs).toEqual(['a.mp4', 'folder']);
    expect(cli.style).toBe('topo');
    expect(cli.width).toBe(1024);
    expect(cli.height).toBe(512);
    expect(cli.hud).toEqual({ heading: true, alt: true, speed: true });
    expect(cli.codec).toBe('h265');
    expect(cli.quality).toBe('low');
    expect(cli.preset).toBe('veryfast');
    expect(cli.skipExisting).toBe(true);
    expect(cli.recurse).toBe(true);
    expect(cli.json).toBe(true);
    expect(configPath).toBe('my.json');
  });

  it('rejects invalid enum values', () => {
    expect(() => parseCliArgs(['x.mp4', '--style', 'nope'])).toThrow();
    expect(() => parseCliArgs(['x.mp4', '--capture', 'canvas'])).toThrow();
    expect(() => parseCliArgs(['x.mp4', '--codec', 'av1'])).toThrow();
    expect(() => parseCliArgs(['x.mp4', '--quality', 'ultra'])).toThrow();
    expect(() => parseCliArgs(['x.mp4', '--preset', 'slow'])).toThrow();
  });

  it('rejects the removed --trail flag', () => {
    expect(() => parseCliArgs(['x.mp4', '--trail', 'full'])).toThrow(/unknown option/);
  });

  it('parses --trail-color and canonicalizes it', () => {
    expect(parseCliArgs(['x.mp4', '--trail-color', '41f0ff']).cli.trailColor).toBe('#41f0ff');
    expect(parseCliArgs(['x.mp4', '--trail-color', '#E63946CC']).cli.trailColor).toBe('#e63946cc');
  });

  it.for(['neon', '#12345', 'rgb(1,2,3)'])(
    'rejects the invalid trail color %s naming the flag',
    (value) => {
      expect(() => parseCliArgs(['x.mp4', '--trail-color', value])).toThrow(
        /invalid value for --trail-color/,
      );
    },
  );

  it('lists --trail-color in the help output', () => {
    expect(buildProgram().helpInformation()).toMatch(/--trail-color <hex>/);
  });

  it.for(['wide', '', '0x10'])('rejects the invalid number %s naming the flag', (value) => {
    expect(() => parseCliArgs(['x.mp4', '--width', value])).toThrow(
      /invalid number for --width/,
    );
  });

  it('does not clobber defaults with absent optional flags', () => {
    const { cli } = parseCliArgs(['clip.mp4']);
    const { config } = resolveConfig({ cli, configPath: null, cwd: os.tmpdir() });
    expect(config.tileCache).toBe(defaultTileCache());
    expect(config.outDir).toBe(path.resolve(os.tmpdir(), 'out'));
    expect(config.browser).toBeNull();
    expect(config.trailColor).toBeNull();
  });

  it('lets config-file values win over defaults on a bare invocation', () => {
    const dir = tmpDir();
    const cfgPath = path.join(dir, '.dronepath.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        width: 320,
        style: 'topo',
        skipExisting: true,
        outSuffix: '_flight',
      }),
    );
    const { cli } = parseCliArgs(['clip.mp4']);
    const { config } = resolveConfig({ cli, configPath: cfgPath, cwd: dir });
    expect(config.width).toBe(320);
    expect(config.style).toBe('topo');
    expect(config.skipExisting).toBe(true);
    expect(config.outSuffix).toBe('_flight');
    expect(config.height).toBe(DEFAULT_CONFIG.height);
    expect(config.hud).toEqual(DEFAULT_CONFIG.hud);
  });

  it('lets explicitly set CLI flags win over the config file', () => {
    const dir = tmpDir();
    const cfgPath = path.join(dir, '.dronepath.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ width: 320, style: 'topo', skipExisting: true }),
    );
    const { cli } = parseCliArgs([
      'clip.mp4', '--width', '512', '--style', 'satellite',
    ]);
    const { config } = resolveConfig({ cli, configPath: cfgPath, cwd: dir });
    expect(config.width).toBe(512);
    expect(config.style).toBe('satellite');
    expect(config.skipExisting).toBe(true);
  });

  it('resolves the default output folder to <cwd>/out', () => {
    const dir = tmpDir();
    const { cli } = parseCliArgs(['clip.mp4']);
    const { config } = resolveConfig({ cli, configPath: null, cwd: dir });
    expect(config.outDir).toBe(path.join(dir, 'out'));
  });

  it('leaves the override layer empty on a bare invocation', () => {
    const { cli } = parseCliArgs(['clip.mp4']);
    expect(cli).toEqual({});
  });

  it('collects the tool overrides when given', () => {
    expect(parseCliArgs(['clip.mp4', '--ffmpeg', 'D:\\ff\\ffmpeg.exe']).cli).toEqual({
      ffmpeg: 'D:\\ff\\ffmpeg.exe',
    });
    expect(
      parseCliArgs(['clip.mp4', '--ffmpeg', 'my-ffmpeg', '--ffprobe', 'my-ffprobe']).cli,
    ).toEqual({ ffmpeg: 'my-ffmpeg', ffprobe: 'my-ffprobe' });
  });

  it('names the offending flag when a value does not fit its option', () => {
    expect(() => parseCliArgs(['x.mp4', '--width', 'wide'])).toThrow(/--width/);
    expect(() => parseCliArgs(['x.mp4', '--workers', 'many'])).toThrow(/--workers/);
    expect(() => parseCliArgs(['x.mp4', '--hud', 'heading,bogus'])).toThrow(/--hud/);
  });

  it('reports the allowed choices for an enum flag', () => {
    expect(() => parseCliArgs(['x.mp4', '--style', 'nope'])).toThrow(
      /Allowed choices are satellite, topo/,
    );
  });
});

describe('--track-out and the deprecated --telemetry-json alias', () => {
  it('parses --track-out into the one override key', () => {
    const { cli, deprecationWarnings } = parseCliArgs(['x.mp4', '--track-out', 'flight.gpx']);
    expect(cli).toEqual({ trackOut: 'flight.gpx' });
    expect(deprecationWarnings).toEqual([]);
  });

  it('normalizes the deprecated --telemetry-json alias onto trackOut and warns', () => {
    const parsed = parseCliArgs(['x.mp4', '--telemetry-json', 'flight.telemetry.json']);
    expect(parsed.cli).toEqual({ trackOut: 'flight.telemetry.json' });
    expect(parsed.deprecationWarnings).toEqual([TELEMETRY_JSON_ALIAS.cliWarning]);
  });

  it('rejects both spellings at once', () => {
    expect(() =>
      parseCliArgs(['x.mp4', '--track-out', 'a.gpx', '--telemetry-json', 'b.json']),
    ).toThrow('--telemetry-json and --track-out cannot be combined (use --track-out)');
  });

  it('records which spelling produced the trackOut override for the merged check', () => {
    expect(parseCliArgs(['x.mp4', '--track-out', 'a.gpx']).trackOutSpelling).toBe('track-out');
    expect(parseCliArgs(['x.mp4', '--telemetry-json', 'a.json']).trackOutSpelling).toBe(
      'telemetry-json',
    );
    expect(parseCliArgs(['x.mp4']).trackOutSpelling).toBeNull();
  });

  it('lists both spellings in the help output', () => {
    const help = buildProgram().helpInformation();
    expect(help).toMatch(/--track-out <file>/);
    expect(help).toMatch(/--telemetry-json <file>/);
    expect(help).toMatch(/deprecated alias/);
  });
});

describe('CONFIG_OPTIONS CLI plumbing', () => {
  it('keeps each option key equal to the camelCase of its long flag', () => {
    for (const row of CONFIG_OPTIONS) {
      const camel = longFlagOf(row.cli.flags)
        .replace(/^--/, '')
        .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      expect(row.key).toBe(camel);
    }
  });

  it('names the long flag in error contexts', () => {
    expect(longFlagOf('-q, --quiet')).toBe('--quiet');
    expect(longFlagOf('--out-dir <dir>')).toBe('--out-dir');
  });
});

const savedExitCode = process.exitCode;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = savedExitCode;
});

async function mainWithMocks(
  env: Record<string, string>,
  runBatch: () => Promise<{ ok: number; skipped: number; failed: number }>,
  extraArgs: string[] = [],
) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  vi.doMock('../src/ffmpeg.js', async (importOriginal) => ({
    ...(await importOriginal<typeof ffmpegModule>()),
    requireFfmpegTools: async () => {},
  }));
  vi.doMock('../src/recordings.js', async (importOriginal) => ({
    ...(await importOriginal<typeof recordingsModule>()),
    collectRecordings: () => [path.join('clips', 'clip.mp4')],
  }));
  vi.doMock('../src/pipeline.js', async (importOriginal) => ({
    ...(await importOriginal<typeof pipelineModule>()),
    runBatch,
  }));
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  try {
    const configPath = path.join(tmpDir(), 'config.json');
    fs.writeFileSync(configPath, '{}');
    const { main: mockedMain } = await import('../src/cli.js');
    await mockedMain([
      'node', 'drone-path', 'clip.mp4', '--out-dir', tmpDir(),
      '--config', configPath,
      ...extraArgs,
    ]);
    return stderr.mock.calls.map((c) => String(c[0])).join('');
  } finally {
    vi.doUnmock('../src/ffmpeg.js');
    vi.doUnmock('../src/recordings.js');
    vi.doUnmock('../src/pipeline.js');
    vi.resetModules();
  }
}

describe('main deprecation warnings', () => {
  it('prints the --telemetry-json warning to stderr even with --quiet', async () => {
    const stderr = await mainWithMocks({}, async () => ({ ok: 1, skipped: 0, failed: 0 }), [
      '--quiet',
      '--telemetry-json', 'flight.telemetry.json',
    ]);
    expect(stderr).toContain('[drone-path] ');
    expect(stderr).toContain(TELEMETRY_JSON_ALIAS.cliWarning);
  });
});

describe('main OTEL_* removal regression', () => {

  const OTEL_ENVS: { name: string; env: Record<string, string> }[] = [
    {
      name: 'endpoint and an unsupported protocol (once a fatal error)',
      env: {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      },
    },
    {
      name: 'endpoint alone (once enabled the exporter)',
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' },
    },
    {
      name: 'traces endpoint, headers and resource attributes',
      env: {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'x-team=flight',
        OTEL_RESOURCE_ATTRIBUTES: 'team=flight',
        OTEL_SERVICE_NAME: 'custom-service',
        OTEL_SDK_DISABLED: 'false',
      },
    },
  ];

  it.for(OTEL_ENVS)('runs the batch unchanged with $name', async ({ env }) => {
    const stderr = await mainWithMocks(env, async () => {
      throw new Error('batch exploded');
    });
    expect(stderr).toContain('[drone-path] ERROR: batch exploded');
    expect(stderr).not.toMatch(/tracing|OTEL|opentelemetry/i);
    expect(process.exitCode).toBe(1);
  });

  it('logs no tracing line and leaves the exit code alone on success', async () => {
    const before = process.exitCode;
    const stderr = await mainWithMocks(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' },
      async () => ({ ok: 1, skipped: 0, failed: 0 }),
    );
    expect(stderr).toContain('done: 1 ok, 0 skipped, 0 failed');
    expect(stderr).not.toMatch(/tracing|OTEL|opentelemetry/i);
    expect(process.exitCode).toBe(before);
  });
});
