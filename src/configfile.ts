import fs from 'node:fs';
import path from 'node:path';

import { userDataDir } from './apppaths.js';
import {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG,
  normalizeDimensions,
  normalizeOverrides,
  validateRenderConfig,
} from './config.js';
import type { ConfigOverrides, RenderConfig } from './config.js';
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

export function loadConfigFile(
  file: string,
  onDeprecated?: (message: string) => void,
): ConfigOverrides {
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
  return normalizeOverrides(raw as Record<string, unknown>, file, onDeprecated);
}

export interface ResolvedConfig {
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
}): ResolvedConfig {
  const cwd = opts.cwd ?? process.cwd();
  const configPath =
    opts.configPath !== undefined && opts.configPath !== null
      ? path.resolve(cwd, opts.configPath)
      : discoverConfigFile(cwd);
  const fileCfg = configPath ? loadConfigFile(configPath, opts.onDeprecated) : {};
  const merged = mergeConfigLayers(fileCfg, opts.cli ?? {});

  validateRenderConfig(merged);
  const normalized = {
    ...merged,
    ...normalizeDimensions(merged.width, merged.height),
  };

  return { config: resolveConfigPaths(normalized, cwd), configPath };
}
