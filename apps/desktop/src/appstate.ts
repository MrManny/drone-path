import path from 'node:path';

import { z } from 'zod';

import {
  DEFAULT_CONFIG,
  SETTINGS_KEYS,
  formatHud,
  parseSettingsPatch,
} from 'drone-path-engine/config';
import type { RenderConfig, SettingsPatch } from 'drone-path-engine/config';
import { isRecord, parseValue, strictShape } from 'drone-path-core/validation';

export const APP_STATE_VERSION = 1;

export interface AppState {
  settings: SettingsPatch | null;
  lastOpenDir: string | null;
  language: string | null;
  archiveRoots: string[];
}

export function emptyAppState(): AppState {
  return { settings: null, lastOpenDir: null, language: null, archiveRoots: [] };
}

function archiveRootKey(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function normalizeArchiveRoots(dirs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    const key = archiveRootKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function fillMissingSettings(raw: unknown): unknown {
  if (!isRecord(raw) || Array.isArray(raw)) return raw;
  const filled = { ...raw };
  for (const key of SETTINGS_KEYS) {
    if (!(key in filled)) filled[key] = DEFAULT_CONFIG[key];
  }
  return filled;
}

const APP_STATE_SHAPE = {
  version: z.unknown().optional(),
  settings: z.unknown().optional(),
  lastOpenDir: z.unknown().optional(),
  language: z.unknown().optional(),
  archiveRoots: z.unknown().optional(),
} as z.ZodRawShape;

const ARCHIVE_ROOTS = z
  .optional(
    z.array(
      z
        .string({
          error: (issue) =>
            `invalid app state: archiveRoots: ${String(issue.input)}`,
        })
        .refine((value) => value.trim().length > 0, {
          error: () => 'invalid app state: archiveRoots entries must be non-empty strings',
        }),
      {
        error: (issue) =>
          `invalid app state: archiveRoots: ${String(issue.input)}`,
      },
    ),
  )
  .transform((value) => normalizeArchiveRoots(value ?? []));

const LAST_OPEN_DIR = z
  .optional(
    z.nullable(
      z.string({
        error: (issue) =>
          `invalid app state: lastOpenDir: ${String(issue.input)}`,
      }),
    ),
  )
  .transform((value) => value ?? null);

export function parseAppState(raw: unknown): AppState {
  const state = parseValue(
    strictShape(APP_STATE_SHAPE, {
      invalid: 'invalid app state',
      unknownKey: (key) => `unknown app state key ${key}`,
    }),
    raw,
  );
  parseValue(
    z.literal(APP_STATE_VERSION, {
      error: (issue) => `unsupported app state version: ${String(issue.input)}`,
    }),
    state.version,
  );
  const settings =
    state.settings === undefined || state.settings === null
      ? null
      : parseSettingsPatch(fillMissingSettings(state.settings), 'app state');
  return {
    settings,
    lastOpenDir: parseValue(LAST_OPEN_DIR, state.lastOpenDir),
    language: typeof state.language === 'string' ? state.language : null,
    archiveRoots: parseValue(ARCHIVE_ROOTS, state.archiveRoots),
  };
}

export function serializeAppState(state: AppState): string {
  const out: Record<string, unknown> = { version: APP_STATE_VERSION };
  if (state.settings) {
    const settings: Record<string, unknown> = {};
    for (const key of SETTINGS_KEYS) {
      settings[key] =
        key === 'hud' ? formatHud(state.settings.hud) : state.settings[key];
    }
    out.settings = settings;
  }
  if (state.lastOpenDir !== null) out.lastOpenDir = state.lastOpenDir;
  if (state.language !== null) out.language = state.language;
  if (state.archiveRoots.length > 0) out.archiveRoots = state.archiveRoots;
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function applyAppState(config: RenderConfig, state: AppState): RenderConfig {
  if (!state.settings) return config;
  return {
    ...config,
    ...state.settings,
    hud: { ...state.settings.hud },
  };
}

export function rememberOpenedFile(state: AppState, filePath: string): AppState {
  return { ...state, lastOpenDir: path.dirname(filePath) };
}

export function addArchiveRoot(state: AppState, dir: string): AppState {
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    throw new Error('archive root must be a non-empty path');
  }
  return {
    ...state,
    archiveRoots: normalizeArchiveRoots([...state.archiveRoots, dir]),
  };
}

export function removeArchiveRoot(state: AppState, dir: string): AppState {
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    throw new Error('archive root must be a non-empty path');
  }
  const target = archiveRootKey(dir);
  return {
    ...state,
    archiveRoots: normalizeArchiveRoots(state.archiveRoots).filter(
      (existing) => archiveRootKey(existing) !== target,
    ),
  };
}
