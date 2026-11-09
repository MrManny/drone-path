import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONFIG, SETTINGS_KEYS, formatHud, parseSettingsPatch } from './config.js';
import type { RenderConfig, SettingsPatch } from './config.js';

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
    throw new Error(`cannot write app state ${file}: ${(e as Error).message}`, {
      cause: e,
    });
  }
}
