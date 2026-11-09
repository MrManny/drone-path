import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { RenderConfig } from './config.js';

export type FfToolName = 'ffmpeg' | 'ffprobe';

export interface FfToolPaths {
  ffmpeg: string;
  ffprobe: string;
}

export type FfOverrides = Pick<RenderConfig, 'ffmpeg' | 'ffprobe'>;

interface FfToolEnv {
  exists: (file: string) => boolean;
  candidates: (tool: FfToolName) => (string | null)[];
}

function isPathLike(value: string): boolean {
  return value.includes('/') || value.includes('\\') || path.isAbsolute(value);
}

export function pickFfTool(
  tool: FfToolName,
  override: string | null,
  candidates: readonly (string | null)[],
  exists: (file: string) => boolean,
): string {
  if (override) {
    if (isPathLike(override) && !exists(override)) {
      throw new Error(
        `invalid ${tool} override (CLI --${tool} or config key \`${tool}\`): no such file: ${override}`,
      );
    }
    return override;
  }
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return tool;
}

function exeName(tool: FfToolName): string {
  return process.platform === 'win32' ? `${tool}.exe` : tool;
}

function packagedCandidate(tool: FfToolName): string | null {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  return resourcesPath ? path.join(resourcesPath, 'ff', exeName(tool)) : null;
}

function devCandidate(tool: FfToolName): string | null {
  try {
    const mod = createRequire(import.meta.url)('ffmpeg-ffprobe-static') as {
      ffmpegPath?: unknown;
      ffprobePath?: unknown;
    };
    const candidate = tool === 'ffmpeg' ? mod.ffmpegPath : mod.ffprobePath;
    return typeof candidate === 'string' ? candidate : null;
  } catch {
    return null;
  }
}

function realEnv(): FfToolEnv {
  return {
    exists: (file) => {
      try {
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    },
    candidates: (tool) => [packagedCandidate(tool), devCandidate(tool)],
  };
}

export function resolveFfTools(
  overrides: FfOverrides,
  env: FfToolEnv = realEnv(),
): FfToolPaths {
  return {
    ffmpeg: pickFfTool('ffmpeg', overrides.ffmpeg, env.candidates('ffmpeg'), env.exists),
    ffprobe: pickFfTool('ffprobe', overrides.ffprobe, env.candidates('ffprobe'), env.exists),
  };
}
