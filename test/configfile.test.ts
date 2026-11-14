import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultTileCache,
  discoverConfigFile,
  loadConfigFile,
  resolveConfig,
} from '../src/configfile.js';
import { DEFAULT_CONFIG, TELEMETRY_JSON_ALIAS } from '../src/config.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('discoverConfigFile', () => {
  it('walks up to the config file', () => {
    const root = tmpDir();
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    const file = path.join(root, '.dronepath.json');
    fs.writeFileSync(file, '{}');
    expect(discoverConfigFile(nested)).toBe(file);
    expect(discoverConfigFile(os.tmpdir())).toBeNull();
  });
});

describe('loadConfigFile', () => {
  it('rejects unknown keys', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"bogus": 1}');
    expect(() => loadConfigFile(file)).toThrow(/unknown config key/);
  });

  it('rejects the removed trail key', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"trail": "incr"}');
    expect(() => loadConfigFile(file)).toThrow(/unknown config key/);
  });

  it('rejects the removed trail key even alongside trailColor', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"trailColor": "#fff", "trail": "incr"}');
    expect(() => loadConfigFile(file)).toThrow(/unknown config key/);
  });

  it('accepts the trail color key', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"trailColor": "41f0ff"}');
    expect(loadConfigFile(file)).toEqual({ overrides: { trailColor: '#41f0ff' }, trackOutSpelling: null });
  });

  it('rejects an unreadable trail color, naming the key', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"trailColor": "neon"}');
    expect(() => loadConfigFile(file)).toThrow(/invalid value for .*trailColor/);
  });

  it('rejects invalid JSON', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{oops');
    expect(() => loadConfigFile(file)).toThrow(/not valid JSON/);
  });

  it('rejects string numbers, naming the key', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"width": "768"}');
    expect(() => loadConfigFile(file)).toThrow(/invalid number for .*width/);
  });

  it('accepts the encoder keys', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"codec": "h265", "quality": "low", "preset": "veryfast"}');
    expect(loadConfigFile(file).overrides).toEqual({
      codec: 'h265',
      quality: 'low',
      preset: 'veryfast',
    });
  });

  it('rejects an unknown quality, naming the key', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"quality": "ultra"}');
    expect(() => loadConfigFile(file)).toThrow(/invalid value for .*quality/);
  });

  it('reports which trackOut spelling the file uses', () => {
    const dir = tmpDir();
    const alias = path.join(dir, 'alias.json');
    fs.writeFileSync(alias, '{"telemetryJson": "a.json"}');
    expect(loadConfigFile(alias).trackOutSpelling).toBe('telemetry-json');

    const canonical = path.join(dir, 'canonical.json');
    fs.writeFileSync(canonical, '{"trackOut": "a.gpx"}');
    expect(loadConfigFile(canonical).trackOutSpelling).toBe('track-out');

    const neither = path.join(dir, 'neither.json');
    fs.writeFileSync(neither, '{"style": "topo"}');
    expect(loadConfigFile(neither).trackOutSpelling).toBeNull();
  });
});

describe('resolveConfig', () => {
  it('applies precedence CLI > file > defaults and resolves paths', () => {
    const root = tmpDir();
    const file = path.join(root, '.dronepath.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ width: 320, style: 'topo', outDir: 'out' }),
    );
    const { config, configPath } = resolveConfig({
      cli: { width: 640 },
      configPath: file,
      cwd: root,
    });
    expect(configPath).toBe(file);
    expect(config.width).toBe(640);
    expect(config.style).toBe('topo');
    expect(config.height).toBe(768);
    expect(config.outDir).toBe(path.join(root, 'out'));
  });

  it('fills the per-user tile cache when no layer sets one', () => {
    const { config } = resolveConfig({ configPath: null, cwd: tmpDir() });
    expect(config.tileCache).toBe(defaultTileCache());
  });

  it('layers the trail color like every other option', () => {
    const root = tmpDir();
    const file = path.join(root, '.dronepath.json');
    fs.writeFileSync(file, JSON.stringify({ trailColor: '#41f0ff' }));
    expect(resolveConfig({ configPath: file, cwd: root }).config.trailColor).toBe('#41f0ff');
    expect(
      resolveConfig({ cli: { trailColor: '#e63946' }, configPath: file, cwd: root }).config
        .trailColor,
    ).toBe('#e63946');
    expect(resolveConfig({ configPath: null, cwd: tmpDir() }).config.trailColor).toBeNull();
  });

  it('rejects the two trackOut spellings combined across the config file and the command line', () => {
    const dir = tmpDir();
    const aliasFile = path.join(dir, 'alias.json');
    fs.writeFileSync(aliasFile, '{"telemetryJson": "a.json"}');
    expect(() =>
      resolveConfig({
        cli: { trackOut: 'b.gpx' },
        cliTrackOutSpelling: 'track-out',
        configPath: aliasFile,
        cwd: dir,
      }),
    ).toThrow(
      '--telemetry-json and --track-out cannot be combined across the command line and the config file',
    );

    // and the deprecated alias may not silently beat the canonical key either
    const canonicalFile = path.join(dir, 'canonical.json');
    fs.writeFileSync(canonicalFile, '{"trackOut": "a.gpx"}');
    expect(() =>
      resolveConfig({
        cli: { trackOut: 'b.json' },
        cliTrackOutSpelling: 'telemetry-json',
        configPath: canonicalFile,
        cwd: dir,
      }),
    ).toThrow(
      '--telemetry-json and --track-out cannot be combined across the command line and the config file',
    );
  });

  it('accepts one spelling used across origins', () => {
    const dir = tmpDir();
    const aliasFile = path.join(dir, 'alias.json');
    fs.writeFileSync(aliasFile, '{"telemetryJson": "a.json"}');
    const warnings: string[] = [];
    const { config } = resolveConfig({
      cli: { trackOut: 'b.json' },
      cliTrackOutSpelling: 'telemetry-json',
      configPath: aliasFile,
      cwd: dir,
      onDeprecated: (message) => warnings.push(message),
    });
    expect(config.trackOut).toBe('b.json');
    expect(warnings).toEqual([TELEMETRY_JSON_ALIAS.fileWarning]);
  });

  it('validates ranges', () => {
    expect(() => resolveConfig({ cli: { workers: 0 }, configPath: null, cwd: tmpDir() })).toThrow(
      /workers/,
    );
    expect(() => resolveConfig({ cli: { width: 10 }, configPath: null, cwd: tmpDir() })).toThrow(
      /at least 64/,
    );
    expect(() =>
      resolveConfig({ cli: { outSuffix: '' }, configPath: null, cwd: tmpDir() }),
    ).toThrow(/out-suffix/);
  });

  it('normalizes odd dimensions to the effective even canvas', () => {
    const root = tmpDir();
    const file = path.join(root, '.dronepath.json');
    fs.writeFileSync(file, '{}');
    const { config } = resolveConfig({
      cli: { width: 767, height: 501 },
      configPath: file,
      cwd: root,
    });
    expect(config.width).toBe(766);
    expect(config.height).toBe(500);
  });

  it('keeps hud state private to each resolved config', () => {
    const root = tmpDir();
    const file = path.join(root, '.dronepath.json');
    fs.writeFileSync(file, '{}');

    const { config: first } = resolveConfig({ configPath: file, cwd: root });
    expect(first.hud).not.toBe(DEFAULT_CONFIG.hud);
    first.hud.alt = true;

    const { config: second } = resolveConfig({ configPath: file, cwd: root });
    expect(second.hud).toEqual(DEFAULT_CONFIG.hud);
    expect(DEFAULT_CONFIG.hud.alt).toBe(false);
    expect(first.hud.alt).toBe(true);
  });
});
