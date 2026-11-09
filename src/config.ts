export type Style = 'satellite' | 'topo';
export type View = 'follow' | 'overview';
export type Capture = 'jpeg' | 'png';
export type Codec = 'h264' | 'h265';
export type Quality = 'near-lossless' | 'high' | 'medium' | 'low';
export type Preset = 'medium' | 'veryfast';

export interface HudSpec {
  heading: boolean;
  alt: boolean;
  speed: boolean;
}

export interface RenderConfig {
  outDir: string | null;
  outSuffix: string;
  width: number;
  height: number;
  style: Style;
  view: View;
  zoom: number;
  zoomOut: number;
  introSec: number;
  outroSec: number;
  trailColor: string | null;
  hud: HudSpec;
  workers: number;
  capture: Capture;
  codec: Codec;
  quality: Quality;
  preset: Preset;
  tileCache: string;
  browser: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  skipExisting: boolean;
  recurse: boolean;
  telemetryJson: string | null;
  json: boolean;
  quiet: boolean;
}

export type ConfigOverrides = Partial<RenderConfig>;

export const CONFIG_FILE_NAME = '.dronepath.json';

export const CONFIG_FILE_OPTION = {
  flags: '--config <path>',
  help: 'config file (default: .dronepath.json discovered upward from the working directory)',
} as const;

export const STYLE_VALUES: readonly Style[] = ['satellite', 'topo'];
export const VIEW_VALUES: readonly View[] = ['follow', 'overview'];
const CAPTURE_VALUES: Capture[] = ['jpeg', 'png'];
export const CODEC_VALUES: readonly Codec[] = ['h264', 'h265'];
export const QUALITY_VALUES: readonly Quality[] = ['near-lossless', 'high', 'medium', 'low'];
export const PRESET_VALUES: readonly Preset[] = ['medium', 'veryfast'];

type OverrideNormalizer = (value: unknown, name: string) => ConfigOverrides;

export function parseHud(list: string): HudSpec {
  const hud: HudSpec = { heading: false, alt: false, speed: false };
  if (!list || list.toLowerCase() === 'none') return hud;
  for (const part of list
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)) {
    if (part === 'heading' || part === 'arrow') hud.heading = true;
    else if (part === 'alt' || part === 'altitude') hud.alt = true;
    else if (part === 'speed') hud.speed = true;
    else
      throw new Error(
        `unknown --hud component: ${part} (use heading,alt,speed or none)`,
      );
  }
  return hud;
}

export function resolveHudSpec(hud: HudSpec, hasAlt: boolean): HudSpec {
  return hud.alt && !hasAlt ? { ...hud, alt: false } : hud;
}

export function hasAltitude(alt: readonly (number | null)[]): boolean {
  return alt.some((a) => a !== null);
}

export function formatHud(hud: HudSpec): string {
  const parts: string[] = [];
  if (hud.heading) parts.push('heading');
  if (hud.alt) parts.push('alt');
  if (hud.speed) parts.push('speed');
  return parts.length ? parts.join(',') : 'none';
}

export function asNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid number for ${name}: ${String(value)}`);
  }
  return value;
}

const CLI_NUMBER_RX = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function cliNumber(raw: unknown): unknown {
  if (typeof raw !== 'string' || !CLI_NUMBER_RX.test(raw.trim())) return raw;
  return Number(raw);
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid value for ${name}: ${String(value)}`);
  }
  return value;
}

function asBool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`invalid value for ${name}: ${String(value)}`);
  }
  return value;
}

function asEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`invalid value for ${name}: ${String(value)} (use ${allowed.join(' | ')})`);
  }
  return value as T;
}

function asNullableString(value: unknown, name: string): string | null {
  if (value === null || value === '') return null;
  return asString(value, name);
}

const TRAIL_COLOR_RX = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function asTrailColor(value: unknown, name: string): string | null {
  const bad = (): Error =>
    new Error(
      `invalid value for ${name}: ${String(value)} (use hex like #e63946 or #e63946cc)`,
    );
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw bad();
  const match = TRAIL_COLOR_RX.exec(value.trim());
  if (!match) throw bad();
  let hex = match[1].toLowerCase();
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  return `#${hex}`;
}

interface CliOptionSpec {
  flags: string;
  help: string;
  choices?: readonly string[];
  parse?: (raw: unknown) => unknown;
}

export interface ConfigOption<K extends keyof RenderConfig = keyof RenderConfig> {
  key: K;
  cli: CliOptionSpec;
  default: RenderConfig[K];
  normalize: OverrideNormalizer;
}

export const CONFIG_OPTIONS: readonly ConfigOption[] = [
  {
    key: 'outDir',
    cli: { flags: '--out-dir <dir>', help: 'output folder' },
    default: 'out',
    normalize: (v, name) => ({ outDir: asNullableString(v, name) }),
  },
  {
    key: 'outSuffix',
    cli: { flags: '--out-suffix <suffix>', help: 'output name = <basename><suffix>.mp4' },
    default: '_map',
    normalize: (v, name) => ({ outSuffix: asString(v, name) }),
  },
  {
    key: 'width',
    cli: { flags: '--width <px>', help: 'canvas width in pixels (rounded down to even)', parse: cliNumber },
    default: 768,
    normalize: (v, name) => ({ width: asNumber(v, name) }),
  },
  {
    key: 'height',
    cli: { flags: '--height <px>', help: 'canvas height in pixels (rounded down to even)', parse: cliNumber },
    default: 768,
    normalize: (v, name) => ({ height: asNumber(v, name) }),
  },
  {
    key: 'style',
    cli: { flags: '--style <name>', help: 'map look', choices: STYLE_VALUES },
    default: 'satellite',
    normalize: (v, name) => ({ style: asEnum(v, name, STYLE_VALUES) }),
  },
  {
    key: 'view',
    cli: {
      flags: '--view <mode>',
      help:
        'follow: drone stays centered and the map slides under it; overview: static whole-track map',
      choices: VIEW_VALUES,
    },
    default: 'follow',
    normalize: (v, name) => ({ view: asEnum(v, name, VIEW_VALUES) }),
  },
  {
    key: 'zoom',
    cli: { flags: '--zoom <n>', help: 'fixed view zoom level (0 = auto-fit to the track)', parse: cliNumber },
    default: 0,
    normalize: (v, name) => ({ zoom: asNumber(v, name) }),
  },
  {
    key: 'zoomOut',
    cli: { flags: '--zoom-out <n>', help: 'auto-fit only: pull back n zoom levels', parse: cliNumber },
    default: 1,
    normalize: (v, name) => ({ zoomOut: asNumber(v, name) }),
  },
  {
    key: 'introSec',
    cli: { flags: '--intro-sec <s>', help: 'intro: zoom in from one level out over s seconds', parse: cliNumber },
    default: 2,
    normalize: (v, name) => ({ introSec: asNumber(v, name) }),
  },
  {
    key: 'outroSec',
    cli: { flags: '--outro-sec <s>', help: 'outro: zoom back out over s seconds', parse: cliNumber },
    default: 2,
    normalize: (v, name) => ({ outroSec: asNumber(v, name) }),
  },
  {
    key: 'trailColor',
    cli: {
      flags: '--trail-color <hex>',
      help:
        'trail color as hex, RGB or RGBA (e.g. e63946 or #e63946cc; default: the map style\'s color)',
    },
    default: null,
    normalize: (v, name) => ({ trailColor: asTrailColor(v, name) }),
  },
  {
    key: 'hud',
    cli: {
      flags: '--hud <list>',
      help: 'comma list of heading,alt,speed - or none (alt hides when unavailable)',
    },
    default: { heading: true, alt: false, speed: false },
    normalize: (v, name) => ({ hud: parseHud(asString(v, name)) }),
  },
  {
    key: 'workers',
    cli: { flags: '--workers <n>', help: 'parallel browser pages', parse: cliNumber },
    default: 4,
    normalize: (v, name) => ({ workers: asNumber(v, name) }),
  },
  {
    key: 'capture',
    cli: { flags: '--capture <mode>', help: 'frame capture mode (canvas is parked)', choices: CAPTURE_VALUES },
    default: 'jpeg',
    normalize: (v, name) => ({ capture: asEnum(v, name, CAPTURE_VALUES) }),
  },
  {
    key: 'codec',
    cli: { flags: '--codec <name>', help: 'video codec (mp4 container)', choices: CODEC_VALUES },
    default: 'h264',
    normalize: (v, name) => ({ codec: asEnum(v, name, CODEC_VALUES) }),
  },
  {
    key: 'quality',
    cli: { flags: '--quality <level>', help: 'encoding quality', choices: QUALITY_VALUES },
    default: 'high',
    normalize: (v, name) => ({ quality: asEnum(v, name, QUALITY_VALUES) }),
  },
  {
    key: 'preset',
    cli: { flags: '--preset <name>', help: 'encoding speed', choices: PRESET_VALUES },
    default: 'medium',
    normalize: (v, name) => ({ preset: asEnum(v, name, PRESET_VALUES) }),
  },
  {
    key: 'tileCache',
    cli: { flags: '--tile-cache <dir>', help: 'tile cache directory (default: per-user cache dir)' },
    default: '',
    normalize: (v, name) => ({ tileCache: asString(v, name) }),
  },
  {
    key: 'browser',
    cli: { flags: '--browser <path>', help: 'Chromium/Chrome/Edge executable (default: system Chrome/Edge)' },
    default: null,
    normalize: (v, name) => ({ browser: asNullableString(v, name) }),
  },
  {
    key: 'ffmpeg',
    cli: { flags: '--ffmpeg <path>', help: 'ffmpeg executable (default: embedded binary, then PATH)' },
    default: null,
    normalize: (v, name) => ({ ffmpeg: asNullableString(v, name) }),
  },
  {
    key: 'ffprobe',
    cli: { flags: '--ffprobe <path>', help: 'ffprobe executable (default: embedded binary, then PATH)' },
    default: null,
    normalize: (v, name) => ({ ffprobe: asNullableString(v, name) }),
  },
  {
    key: 'skipExisting',
    cli: {
      flags: '--skip-existing',
      help: 'skip recordings whose output already exists and matches the source',
    },
    default: false,
    normalize: (v, name) => ({ skipExisting: asBool(v, name) }),
  },
  {
    key: 'recurse',
    cli: { flags: '--recurse', help: 'scan input folders recursively' },
    default: false,
    normalize: (v, name) => ({ recurse: asBool(v, name) }),
  },
  {
    key: 'telemetryJson',
    cli: {
      flags: '--telemetry-json <file>',
      help: 'write one JSON document with per-frame telemetry to <file> (one recording per run)',
    },
    default: null,
    normalize: (v, name) => ({ telemetryJson: asNullableString(v, name) }),
  },
  {
    key: 'json',
    cli: { flags: '--json', help: 'print one NDJSON summary line per recording on stdout' },
    default: false,
    normalize: (v, name) => ({ json: asBool(v, name) }),
  },
  {
    key: 'quiet',
    cli: { flags: '-q, --quiet', help: 'suppress progress output' },
    default: false,
    normalize: (v, name) => ({ quiet: asBool(v, name) }),
  },
];

export function cliDefaultOf(key: keyof RenderConfig): string | boolean {
  const row = CONFIG_OPTIONS.find((r) => r.key === key);
  if (!row) throw new Error(`unknown config key ${String(key)}`);
  const value = row.default as unknown;
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return '';
  return key === 'hud' ? formatHud(value as HudSpec) : String(value);
}

export const DEFAULT_CONFIG: RenderConfig = Object.freeze(
  Object.fromEntries(
    CONFIG_OPTIONS.map((row) => [row.key, row.default]),
  ) as unknown as RenderConfig,
);
Object.freeze(DEFAULT_CONFIG.hud);

const OVERRIDE_NORMALIZERS: Record<keyof RenderConfig, OverrideNormalizer> =
  Object.fromEntries(
    CONFIG_OPTIONS.map((row) => [row.key, row.normalize]),
  ) as Record<keyof RenderConfig, OverrideNormalizer>;

export function normalizeOverrides(
  raw: Record<string, unknown>,
  origin: string,
): ConfigOverrides {
  const out: ConfigOverrides = {};
  for (const key of Object.keys(raw)) {
    const normalize = Object.hasOwn(OVERRIDE_NORMALIZERS, key)
      ? OVERRIDE_NORMALIZERS[key as keyof RenderConfig]
      : null;
    if (!normalize) throw new Error(`unknown config key ${key} in ${origin}`);
    const value = raw[key];
    if (value === undefined) continue;
    if (value === null && DEFAULT_CONFIG[key as keyof RenderConfig] !== null) continue;
    Object.assign(out, normalize(value, `${origin}: ${key}`));
  }
  return out;
}

export function effectiveZoomOut(config: Pick<RenderConfig, 'zoom' | 'zoomOut'>): number {
  return config.zoom > 0 ? 0 : config.zoomOut;
}

export type EncodeSettings = Pick<RenderConfig, 'codec' | 'quality' | 'preset'>;

export type LookSettings = Pick<
  RenderConfig,
  'style' | 'view' | 'zoom' | 'zoomOut' | 'hud' | 'introSec' | 'outroSec' | 'trailColor'
>;

export type SettingsPatch = LookSettings & EncodeSettings;

export function settingsPatchOf(config: RenderConfig): SettingsPatch {
  return {
    style: config.style,
    view: config.view,
    zoom: config.zoom,
    zoomOut: config.zoomOut,
    hud: config.hud,
    introSec: config.introSec,
    outroSec: config.outroSec,
    trailColor: config.trailColor,
    codec: config.codec,
    quality: config.quality,
    preset: config.preset,
  };
}

export const SETTINGS_KEYS = [
  'style',
  'view',
  'zoom',
  'zoomOut',
  'hud',
  'introSec',
  'outroSec',
  'trailColor',
  'codec',
  'quality',
  'preset',
] as const;

export function parseSettingsPatch(raw: unknown, origin: string): SettingsPatch {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`invalid settings in ${origin}`);
  }
  const flat = { ...(raw as Record<string, unknown>) };
  for (const key of Object.keys(flat)) {
    if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
      throw new Error(`unknown settings key ${key} in ${origin}`);
    }
  }
  if (flat.hud !== undefined && flat.hud !== null && typeof flat.hud !== 'string') {
    flat.hud = formatHud(parseHudObject(flat.hud, `${origin}: hud`));
  }
  const patch = normalizeOverrides(flat, origin);
  for (const key of SETTINGS_KEYS) {
    if (patch[key] === undefined) {
      throw new Error(`missing settings key ${key} in ${origin}`);
    }
  }
  const settings = patch as SettingsPatch;
  validateRenderConfig({ ...DEFAULT_CONFIG, ...settings, hud: { ...settings.hud } });
  return settings;
}

export const MIN_DIMENSION = 64;

// Negated comparisons are NaN-safe (NaN would slip through <).
export function validateDimensions(width: number, height: number): void {
  if (!(width >= MIN_DIMENSION) || !(height >= MIN_DIMENSION)) {
    throw new Error(`width and height must be at least ${MIN_DIMENSION}`);
  }
}

export function normalizeDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  return {
    width: Math.max(MIN_DIMENSION, 2 * Math.floor(width / 2)),
    height: Math.max(MIN_DIMENSION, 2 * Math.floor(height / 2)),
  };
}

export function validateRenderConfig(config: RenderConfig): void {
  validateDimensions(config.width, config.height);
  if (!Number.isInteger(config.workers) || config.workers < 1) {
    throw new Error('workers must be a positive integer');
  }
  if (!(config.zoom >= 0)) throw new Error('zoom must be >= 0 (0 = auto-fit)');
  if (!(config.zoomOut >= 0)) throw new Error('zoom-out must be >= 0');
  if (!(config.introSec >= 0) || !(config.outroSec >= 0)) {
    throw new Error('intro-sec and outro-sec must be >= 0');
  }
  if (!config.outSuffix) throw new Error('out-suffix must not be empty');
}

export interface FrameRange {
  start: number;
  end: number;
}

export interface ExportRequest {
  outPath: string;
  config: RenderConfig;
  range: FrameRange | null;
}

export function assertValidFrameRange(range: FrameRange, name = 'frame range'): void {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new Error(`invalid ${name}: start and end must be integer frame indices`);
  }
  if (range.start < 0 || range.start >= range.end) {
    throw new Error(`invalid ${name}: expected 0 <= start < end, got ${range.start}-${range.end}`);
  }
}

export function parseFrameRange(raw: unknown, name = 'frame range'): FrameRange {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`invalid ${name}`);
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (key !== 'start' && key !== 'end') {
      throw new Error(`unknown ${name} key ${key}`);
    }
  }
  const start = asNumber(r.start, `${name}: start`);
  const end = asNumber(r.end, `${name}: end`);
  assertValidFrameRange({ start, end }, name);
  return { start, end };
}

function parseHudObject(value: unknown, name: string): HudSpec {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`invalid value for ${name}`);
  }
  const h = value as Record<string, unknown>;
  for (const key of Object.keys(h)) {
    if (key !== 'heading' && key !== 'alt' && key !== 'speed') {
      throw new Error(`unknown key ${key} in ${name}`);
    }
  }
  return {
    heading: asBool(h.heading, `${name}: heading`),
    alt: asBool(h.alt, `${name}: alt`),
    speed: asBool(h.speed, `${name}: speed`),
  };
}

const MAIN_OWNED_KEYS = [
  'outDir', 'outSuffix', 'tileCache', 'browser', 'ffmpeg', 'ffprobe', 'workers', 'capture',
  'skipExisting', 'recurse', 'telemetryJson', 'json', 'quiet',
] as const;

function parseRequestConfig(raw: unknown, base: RenderConfig): RenderConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid export request: config');
  }
  const flat = { ...(raw as Record<string, unknown>) };
  for (const key of MAIN_OWNED_KEYS) delete flat[key];
  if (flat.hud !== undefined && flat.hud !== null) {
    flat.hud = formatHud(parseHudObject(flat.hud, 'export request: config: hud'));
  }
  const config = { ...base, ...normalizeOverrides(flat, 'export request: config') };
  validateRenderConfig(config);
  return { ...config, ...normalizeDimensions(config.width, config.height) };
}

export function parseExportRequest(raw: unknown, base: RenderConfig): ExportRequest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid export request');
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (key !== 'outPath' && key !== 'config' && key !== 'range') {
      throw new Error(`unknown export request key ${key}`);
    }
  }
  const outPath = asString(r.outPath, 'export request: outPath');
  if (!outPath.toLowerCase().endsWith('.mp4')) {
    throw new Error(`export request: outPath must be an .mp4 file: ${outPath}`);
  }
  const range =
    r.range === undefined || r.range === null ? null : parseFrameRange(r.range);
  return { outPath, config: parseRequestConfig(r.config, base), range };
}
