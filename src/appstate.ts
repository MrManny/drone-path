import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  DEFAULT_CONFIG,
  SETTINGS_KEYS,
  formatHud,
  parseSettingsPatch,
  parseValue,
  strictShape,
} from './config.js';
import type { RenderConfig, SettingsPatch } from './config.js';
import { errorMessage } from './errors.js';

export const APP_STATE_VERSION = 1;

export interface AppState {
  settings: SettingsPatch | null;
  lastOpenDir: string | null;
}

export function emptyAppState(): AppState {
  return { settings: null, lastOpenDir: null };
}

function fillMissingSettings(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const filled = { ...(raw as Record<string, unknown>) };
  for (const key of SETTINGS_KEYS) {
    if (!(key in filled)) filled[key] = DEFAULT_CONFIG[key];
  }
  return filled;
}

const APP_STATE_SHAPE = {
  version: z.unknown().optional(),
  settings: z.unknown().optional(),
  lastOpenDir: z.unknown().optional(),
} as z.ZodRawShape;

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
  return { settings, lastOpenDir: parseValue(LAST_OPEN_DIR, state.lastOpenDir) };
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

export function readAppState(file: string): AppState {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return emptyAppState();
  }
  try {
    return parseAppState(JSON.parse(text));
  } catch {
    return emptyAppState();
  }
}

export function writeAppState(file: string, state: AppState): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serializeAppState(state));
  } catch (e) {
    throw new Error(`cannot write app state ${file}: ${errorMessage(e)}`, {
      cause: e,
    });
  }
}
