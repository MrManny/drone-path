// The desktop app's per-user state: the settings panel's last look in
// option-vocabulary values and the folder the last recording was opened from.
// Parsing and merging stay pure; the file I/O below them is the thin shell the
// app seeds from and flushes to.

import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONFIG, SETTINGS_KEYS, formatHud, parseSettingsPatch } from './config.js';
import type { RenderConfig, SettingsPatch } from './config.js';

export const APP_STATE_VERSION = 1;

export interface AppState {
  /** The persisted look; null when nothing usable is persisted. */
  settings: SettingsPatch | null;
  /** The folder the last recording was opened from; null when none yet. */
  lastOpenDir: string | null;
}

export function emptyAppState(): AppState {
  return { settings: null, lastOpenDir: null };
}

// Older settings objects read tolerantly: a key their writer did not know
// starts at its documented default, so an upgrade keeps the look the user
// chose. A present-but-mistyped value (null included) stays the parser's
// business and fails the state.
function fillMissingSettings(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const filled = { ...(raw as Record<string, unknown>) };
  for (const key of SETTINGS_KEYS) {
    if (!(key in filled)) filled[key] = DEFAULT_CONFIG[key];
  }
  return filled;
}

// The state falls back as a whole: a file whose shape this build cannot read
// is outdated or corrupt, and keeping parts of it would restore a look the
// user never chose.
export function parseAppState(raw: unknown): AppState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('invalid app state');
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (key !== 'version' && key !== 'settings' && key !== 'lastOpenDir') {
      throw new Error(`unknown app state key ${key}`);
    }
  }
  if (r.version !== APP_STATE_VERSION) {
    throw new Error(`unsupported app state version: ${String(r.version)}`);
  }
  const settings =
    r.settings === undefined || r.settings === null
      ? null
      : parseSettingsPatch(fillMissingSettings(r.settings), 'app state');
  if (r.lastOpenDir !== undefined && r.lastOpenDir !== null && typeof r.lastOpenDir !== 'string') {
    throw new Error(`invalid app state: lastOpenDir: ${String(r.lastOpenDir)}`);
  }
  const lastOpenDir = typeof r.lastOpenDir === 'string' ? r.lastOpenDir : null;
  return { settings, lastOpenDir };
}

// The file's option values use the config-file spelling (the HUD spec as its
// CLI string), so a state file reads like .neo2flightpath.json.
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

// The persisted look seeds the panel and the export base; machine-owned values
// always stay whatever the config layers resolved.
export function applyAppState(config: RenderConfig, state: AppState): RenderConfig {
  if (!state.settings) return config;
  return {
    ...config,
    ...state.settings,
    // hud is an object; the winner is copied so no two configs share it.
    hud: { ...state.settings.hud },
  };
}

export function rememberOpenedFile(state: AppState, filePath: string): AppState {
  return { ...state, lastOpenDir: path.dirname(filePath) };
}

// A missing or unusable state file is a fresh install: never a failure the
// launch would die on.
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
    throw new Error(`cannot write app state ${file}: ${(e as Error).message}`, {
      cause: e,
    });
  }
}
