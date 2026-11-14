import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { RenderConfig } from './config.js';

export const FFMPEG_TOOL_NAMES = ['ffmpeg', 'ffprobe'] as const;
export type FfmpegToolName = (typeof FFMPEG_TOOL_NAMES)[number];

export interface FfmpegToolPaths {
  ffmpeg: string;
  ffprobe: string;
}

type FfmpegToolOverrides = Pick<RenderConfig, 'ffmpeg' | 'ffprobe'>;

interface FfmpegToolEnv {
  exists: (file: string) => boolean;
  candidates: (tool: FfmpegToolName) => (string | null)[];
}

function isPathLike(value: string): boolean {
  return value.includes('/') || value.includes('\\') || path.isAbsolute(value);
}

export function pickFfmpegTool(
  tool: FfmpegToolName,
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

function exeName(tool: FfmpegToolName): string {
  return process.platform === 'win32' ? `${tool}.exe` : tool;
}

function packagedCandidate(tool: FfmpegToolName): string | null {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  return resourcesPath ? path.join(resourcesPath, 'ff', exeName(tool)) : null;
}

function devCandidate(tool: FfmpegToolName): string | null {
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

function realEnv(): FfmpegToolEnv {
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

export function resolveFfmpegTools(
  overrides: FfmpegToolOverrides,
  env: FfmpegToolEnv = realEnv(),
): FfmpegToolPaths {
  return {
    ffmpeg: pickFfmpegTool('ffmpeg', overrides.ffmpeg, env.candidates('ffmpeg'), env.exists),
    ffprobe: pickFfmpegTool('ffprobe', overrides.ffprobe, env.candidates('ffprobe'), env.exists),
  };
}
