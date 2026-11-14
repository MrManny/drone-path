import fs from 'node:fs';
import path from 'node:path';

import { userDataDir } from './apppaths.js';
import {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG,
  assertOneTrackOutSpelling,
  normalizeDimensions,
  normalizeOverrides,
  trackOutSpellingOf,
  validateRenderConfig,
} from './config.js';
import type { ConfigOverrides, RenderConfig, TrackOutSpelling } from './config.js';
import { errorMessage } from './errors.js';

export function defaultTileCache(): string {
  const override = process.env['DRONEPATH_TILE_CACHE'];
  if (override) return path.resolve(override);
  return path.join(userDataDir(), 'tiles');
}

export function discoverConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

interface ConfigFileLayer {
  overrides: ConfigOverrides;
  trackOutSpelling: TrackOutSpelling | null;
}

export function loadConfigFile(
  file: string,
  onDeprecated?: (message: string) => void,
): ConfigFileLayer {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`cannot read config file ${file}: ${errorMessage(e)}`, {
      cause: e,
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `config file is not valid JSON: ${file}: ${errorMessage(e)}`,
      { cause: e },
    );
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`config file must contain a JSON object: ${file}`);
  }
  const input = raw as Record<string, unknown>;
  return {
    overrides: normalizeOverrides(input, file, onDeprecated),
    trackOutSpelling: trackOutSpellingOf(input, file),
  };
}

interface ResolvedConfig {
  config: RenderConfig;
  configPath: string | null;
}

function mergeConfigLayers(
  fileCfg: ConfigOverrides,
  cli: ConfigOverrides,
): RenderConfig {
  return {
    ...DEFAULT_CONFIG,
    ...fileCfg,
    ...cli,
    hud: { ...(cli.hud ?? fileCfg.hud ?? DEFAULT_CONFIG.hud) },
  };
}

function resolveConfigPaths(config: RenderConfig, cwd: string): RenderConfig {
  return {
    ...config,
    tileCache: path.resolve(cwd, config.tileCache || defaultTileCache()),
    outDir: config.outDir ? path.resolve(cwd, config.outDir) : null,
  };
}

export function resolveConfig(opts: {
  cli?: ConfigOverrides;
  configPath?: string | null;
  cwd?: string;
  onDeprecated?: (message: string) => void;
  cliTrackOutSpelling?: TrackOutSpelling | null;
}): ResolvedConfig {
  const cwd = opts.cwd ?? process.cwd();
  const configPath =
    opts.configPath !== undefined && opts.configPath !== null
      ? path.resolve(cwd, opts.configPath)
      : discoverConfigFile(cwd);
  const fileLayer: ConfigFileLayer = configPath
    ? loadConfigFile(configPath, opts.onDeprecated)
    : { overrides: {}, trackOutSpelling: null };
  // The merged effective config may use only one spelling of the trackOut
  // key - across origins, not just within one of them.
  assertOneTrackOutSpelling([
    { origin: 'the config file', spelling: fileLayer.trackOutSpelling },
    { origin: 'the command line', spelling: opts.cliTrackOutSpelling ?? null },
  ]);
  const merged = mergeConfigLayers(fileLayer.overrides, opts.cli ?? {});

  validateRenderConfig(merged);
  const normalized = {
    ...merged,
    ...normalizeDimensions(merged.width, merged.height),
  };

  return { config: resolveConfigPaths(normalized, cwd), configPath };
}
