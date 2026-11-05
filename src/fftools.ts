// Where the ffmpeg and ffprobe executables come from at runtime: an explicit
// override, then the embedded binaries (the packaged app's extraResources, or
// the optional ffmpeg-ffprobe-static package in dev/CLI installs), then PATH.
// Pure decision core with an injectable environment so the resolution order is
// testable without touching the filesystem or spawning anything.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { RenderConfig } from './config.js';

export type FfToolName = 'ffmpeg' | 'ffprobe';

/** The resolved commands to spawn: absolute paths or bare PATH names. */
export interface FfToolPaths {
  ffmpeg: string;
  ffprobe: string;
}

export type FfOverrides = Pick<RenderConfig, 'ffmpeg' | 'ffprobe'>;

interface FfToolEnv {
  exists: (file: string) => boolean;
  /** Embedded-binary candidates in resolution order (packaged first). */
  candidates: (tool: FfToolName) => (string | null)[];
}

// A bare command name defers to spawn's PATH lookup; anything that looks like
// a path is the documented `<path>` override and must name a real file.
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

// The optional ffmpeg-ffprobe-static package may be absent (unsupported
// platform, --omit=optional, a failed install download) and must never crash
// module loading: resolve it lazily.
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
