import { z } from 'zod';

export const MAP_STYLE_VALUES = ['satellite', 'topo'] as const;
export type MapStyle = (typeof MAP_STYLE_VALUES)[number];
const VIEW_MODE_VALUES = ['follow', 'overview'] as const;
export type ViewMode = (typeof VIEW_MODE_VALUES)[number];
const CAPTURE_FORMAT_VALUES = ['jpeg', 'png'] as const;
export type CaptureFormat = (typeof CAPTURE_FORMAT_VALUES)[number];
export const CODEC_VALUES = ['h264', 'h265'] as const;
export type Codec = (typeof CODEC_VALUES)[number];
export const QUALITY_VALUES = ['near-lossless', 'high', 'medium', 'low'] as const;
export type Quality = (typeof QUALITY_VALUES)[number];
export const ENCODER_PRESET_VALUES = ['medium', 'veryfast'] as const;
export type EncoderPreset = (typeof ENCODER_PRESET_VALUES)[number];

export interface HudLayout {
  heading: boolean;
  alt: boolean;
  speed: boolean;
}

export interface RenderConfig {
  outDir: string | null;
  outSuffix: string;
  width: number;
  height: number;
  style: MapStyle;
  view: ViewMode;
  zoom: number;
  zoomOut: number;
  introSec: number;
  outroSec: number;
  trailColor: string | null;
  hud: HudLayout;
  workers: number;
  capture: CaptureFormat;
  codec: Codec;
  quality: Quality;
  preset: EncoderPreset;
  tileCache: string;
  browser: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  skipExisting: boolean;
  recurse: boolean;
  trackOut: string | null;
  json: boolean;
  quiet: boolean;
}

export type ConfigOverrides = Partial<RenderConfig>;

export const CONFIG_FILE_NAME = '.dronepath.json';

export const CONFIG_FILE_OPTION = {
  flags: '--config <path>',
  help: 'config file (default: .dronepath.json discovered upward from the working directory)',
} as const;

type OverrideNormalizer<K extends keyof RenderConfig> = (
  value: unknown,
  name: string,
) => Pick<ConfigOverrides, K>;

export function parseHud(list: string): HudLayout {
  const hud: HudLayout = { heading: false, alt: false, speed: false };
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

export function resolveHudLayout(hud: HudLayout, hasAlt: boolean): HudLayout {
  return hud.alt && !hasAlt ? { ...hud, alt: false } : hud;
}

export function hasAltitude(alt: readonly (number | null)[]): boolean {
  return alt.some((a) => a !== null);
}

export function formatHud(hud: HudLayout): string {
  const parts: string[] = [];
  if (hud.heading) parts.push('heading');
  if (hud.alt) parts.push('alt');
  if (hud.speed) parts.push('speed');
  return parts.length ? parts.join(',') : 'none';
}

// The schemas below own the checks; the error wording stays the legacy one so
// CLI, config file and IPC errors read exactly as before.
interface IssueInput {
  input?: unknown;
}

const invalidValue = (name: string) => (issue: IssueInput): string =>
  `invalid value for ${name}: ${String(issue.input)}`;

const invalidNumber = (name: string) => (issue: IssueInput): string =>
  `invalid number for ${name}: ${String(issue.input)}`;

export function parseValue<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  // The legacy key loops ran before the value checks; surface an unknown-key
  // issue first so multi-error input keeps reporting in that order.
  const issue =
    result.error.issues.find((i) => i.code === 'unrecognized_keys') ??
    result.error.issues[0];
  throw new Error(issue.message, { cause: result.error });
}

interface ShapeWording {
  invalid: string;
  unknownKey: (key: string) => string;
}

export function strictShape<T extends z.ZodRawShape>(
  shape: T,
  wording: ShapeWording,
) {
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? wording.unknownKey(issue.keys[0])
        : wording.invalid,
  });
}

function numberValue(name: string): z.ZodType<number> {
  return z.number({ error: invalidNumber(name) });
}

function stringValue(name: string): z.ZodType<string> {
  return z
    .string({ error: invalidValue(name) })
    .min(1, { error: invalidValue(name) });
}

function boolValue(name: string): z.ZodType<boolean> {
  return z.boolean({ error: invalidValue(name) });
}

function enumValue<T extends string>(
  name: string,
  values: readonly T[],
): z.ZodType<T> {
  return z.enum(values, {
    error: (issue) =>
      `invalid value for ${name}: ${String(issue.input)} (use ${values.join(' | ')})`,
  });
}

function nullableStringValue(name: string): z.ZodType<string | null> {
  return z
    .nullable(z.string({ error: invalidValue(name) }))
    .transform((value) => (value === '' ? null : value));
}

// The legacy key loops ran Object.keys on any object, arrays included;
// spreading keeps exactly those keys visible to the strict shapes below.
const keyedObjectInput = (value: unknown): unknown =>
  typeof value === 'object' && value !== null ? { ...value } : value;

// The whitespace tolerance matches the legacy trim-before-match so the error
// can echo the raw untrimmed input.
const TRAIL_COLOR_RX = /^\s*#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\s*$/i;

function canonicalTrailColor(value: string): string {
  const hex = value.trim().replace(/^#/, '').toLowerCase();
  return `#${hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex}`;
}

function trailColorValue(name: string): z.ZodType<string | null> {
  const bad = (issue: IssueInput): string =>
    `invalid value for ${name}: ${String(issue.input)} (use hex like #e63946 or #e63946cc)`;
  return z
    .union(
      [z.null(), z.literal(''), z.string().regex(TRAIL_COLOR_RX, { error: bad })],
      { error: bad },
    )
    .transform((value) =>
      value === null || value === '' ? null : canonicalTrailColor(value),
    );
}

export function asTrailColor(value: unknown, name: string): string | null {
  return parseValue(trailColorValue(name), value);
}

function hudSpecSchema(name: string): z.ZodType<HudLayout> {
  return z.preprocess(
    keyedObjectInput,
    strictShape(
      {
        heading: boolValue(`${name}: heading`),
        alt: boolValue(`${name}: alt`),
        speed: boolValue(`${name}: speed`),
      },
      {
        invalid: `invalid value for ${name}`,
        unknownKey: (key) => `unknown key ${key} in ${name}`,
      },
    ),
  );
}

function patchHud(value: unknown, name: string): HudLayout | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string'
    ? parseHud(parseValue(stringValue(name), value))
    : parseValue(hudSpecSchema(name), value);
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
  normalize: OverrideNormalizer<K>;
}

export type AnyConfigOption = {
  [K in keyof RenderConfig]: ConfigOption<K>;
}[keyof RenderConfig];

// Literal-first on purpose: the mapped satisfies turns a missing or extra key
// into a compile error, so every RenderConfig key keeps exactly one normalizer.
export const OVERRIDE_NORMALIZERS = {
  outDir: (v, name) => ({ outDir: parseValue(nullableStringValue(name), v) }),
  outSuffix: (v, name) => ({ outSuffix: parseValue(stringValue(name), v) }),
  width: (v, name) => ({ width: parseValue(numberValue(name), v) }),
  height: (v, name) => ({ height: parseValue(numberValue(name), v) }),
  style: (v, name) => ({ style: parseValue(enumValue(name, MAP_STYLE_VALUES), v) }),
  view: (v, name) => ({ view: parseValue(enumValue(name, VIEW_MODE_VALUES), v) }),
  zoom: (v, name) => ({ zoom: parseValue(numberValue(name), v) }),
  zoomOut: (v, name) => ({ zoomOut: parseValue(numberValue(name), v) }),
  introSec: (v, name) => ({ introSec: parseValue(numberValue(name), v) }),
  outroSec: (v, name) => ({ outroSec: parseValue(numberValue(name), v) }),
  trailColor: (v, name) => ({ trailColor: asTrailColor(v, name) }),
  hud: (v, name) => ({ hud: parseHud(parseValue(stringValue(name), v)) }),
  workers: (v, name) => ({ workers: parseValue(numberValue(name), v) }),
  capture: (v, name) => ({ capture: parseValue(enumValue(name, CAPTURE_FORMAT_VALUES), v) }),
  codec: (v, name) => ({ codec: parseValue(enumValue(name, CODEC_VALUES), v) }),
  quality: (v, name) => ({ quality: parseValue(enumValue(name, QUALITY_VALUES), v) }),
  preset: (v, name) => ({ preset: parseValue(enumValue(name, ENCODER_PRESET_VALUES), v) }),
  tileCache: (v, name) => ({ tileCache: parseValue(stringValue(name), v) }),
  browser: (v, name) => ({ browser: parseValue(nullableStringValue(name), v) }),
  ffmpeg: (v, name) => ({ ffmpeg: parseValue(nullableStringValue(name), v) }),
  ffprobe: (v, name) => ({ ffprobe: parseValue(nullableStringValue(name), v) }),
  skipExisting: (v, name) => ({ skipExisting: parseValue(boolValue(name), v) }),
  recurse: (v, name) => ({ recurse: parseValue(boolValue(name), v) }),
  trackOut: (v, name) => ({ trackOut: parseValue(nullableStringValue(name), v) }),
  json: (v, name) => ({ json: parseValue(boolValue(name), v) }),
  quiet: (v, name) => ({ quiet: parseValue(boolValue(name), v) }),
} satisfies { [K in keyof RenderConfig]: OverrideNormalizer<K> };

export const CONFIG_OPTIONS: readonly AnyConfigOption[] = [
  {
    key: 'outDir',
    cli: { flags: '--out-dir <dir>', help: 'output folder' },
    default: 'out',
    normalize: OVERRIDE_NORMALIZERS.outDir,
  },
  {
    key: 'outSuffix',
    cli: { flags: '--out-suffix <suffix>', help: 'output name = <basename><suffix>.mp4' },
    default: '_map',
    normalize: OVERRIDE_NORMALIZERS.outSuffix,
  },
  {
    key: 'width',
    cli: { flags: '--width <px>', help: 'canvas width in pixels (rounded down to even)', parse: cliNumber },
    default: 768,
    normalize: OVERRIDE_NORMALIZERS.width,
  },
  {
    key: 'height',
    cli: { flags: '--height <px>', help: 'canvas height in pixels (rounded down to even)', parse: cliNumber },
    default: 768,
    normalize: OVERRIDE_NORMALIZERS.height,
  },
  {
    key: 'style',
    cli: { flags: '--style <name>', help: 'map look', choices: MAP_STYLE_VALUES },
    default: 'satellite',
    normalize: OVERRIDE_NORMALIZERS.style,
  },
  {
    key: 'view',
    cli: {
      flags: '--view <mode>',
      help:
        'follow: drone stays centered and the map slides under it; overview: static whole-track map',
      choices: VIEW_MODE_VALUES,
    },
    default: 'follow',
    normalize: OVERRIDE_NORMALIZERS.view,
  },
  {
    key: 'zoom',
    cli: { flags: '--zoom <n>', help: 'fixed view zoom level (0 = auto-fit to the track)', parse: cliNumber },
    default: 0,
    normalize: OVERRIDE_NORMALIZERS.zoom,
  },
  {
    key: 'zoomOut',
    cli: { flags: '--zoom-out <n>', help: 'auto-fit only: pull back n zoom levels', parse: cliNumber },
    default: 1,
    normalize: OVERRIDE_NORMALIZERS.zoomOut,
  },
  {
    key: 'introSec',
    cli: { flags: '--intro-sec <s>', help: 'intro: zoom in from one level out over s seconds', parse: cliNumber },
    default: 2,
    normalize: OVERRIDE_NORMALIZERS.introSec,
  },
  {
    key: 'outroSec',
    cli: { flags: '--outro-sec <s>', help: 'outro: zoom back out over s seconds', parse: cliNumber },
    default: 2,
    normalize: OVERRIDE_NORMALIZERS.outroSec,
  },
  {
    key: 'trailColor',
    cli: {
      flags: '--trail-color <hex>',
      help:
        'trail color as hex, RGB or RGBA (e.g. e63946 or #e63946cc; default: the map style\'s color)',
    },
    default: null,
    normalize: OVERRIDE_NORMALIZERS.trailColor,
  },
  {
    key: 'hud',
    cli: {
      flags: '--hud <list>',
      help: 'comma list of heading,alt,speed - or none (alt hides when unavailable)',
    },
    default: { heading: true, alt: false, speed: false },
    normalize: OVERRIDE_NORMALIZERS.hud,
  },
  {
    key: 'workers',
    cli: { flags: '--workers <n>', help: 'parallel browser pages', parse: cliNumber },
    default: 4,
    normalize: OVERRIDE_NORMALIZERS.workers,
  },
  {
    key: 'capture',
    cli: { flags: '--capture <mode>', help: 'frame capture mode (canvas is parked)', choices: CAPTURE_FORMAT_VALUES },
    default: 'jpeg',
    normalize: OVERRIDE_NORMALIZERS.capture,
  },
  {
    key: 'codec',
    cli: { flags: '--codec <name>', help: 'video codec (mp4 container)', choices: CODEC_VALUES },
    default: 'h264',
    normalize: OVERRIDE_NORMALIZERS.codec,
  },
  {
    key: 'quality',
    cli: { flags: '--quality <level>', help: 'encoding quality', choices: QUALITY_VALUES },
    default: 'high',
    normalize: OVERRIDE_NORMALIZERS.quality,
  },
  {
    key: 'preset',
    cli: { flags: '--preset <name>', help: 'encoding speed', choices: ENCODER_PRESET_VALUES },
    default: 'medium',
    normalize: OVERRIDE_NORMALIZERS.preset,
  },
  {
    key: 'tileCache',
    cli: { flags: '--tile-cache <dir>', help: 'tile cache directory (default: per-user cache dir)' },
    default: '',
    normalize: OVERRIDE_NORMALIZERS.tileCache,
  },
  {
    key: 'browser',
    cli: { flags: '--browser <path>', help: 'Chromium/Chrome/Edge executable (default: system Chrome/Edge)' },
    default: null,
    normalize: OVERRIDE_NORMALIZERS.browser,
  },
  {
    key: 'ffmpeg',
    cli: { flags: '--ffmpeg <path>', help: 'ffmpeg executable (default: embedded binary, then PATH)' },
    default: null,
    normalize: OVERRIDE_NORMALIZERS.ffmpeg,
  },
  {
    key: 'ffprobe',
    cli: { flags: '--ffprobe <path>', help: 'ffprobe executable (default: embedded binary, then PATH)' },
    default: null,
    normalize: OVERRIDE_NORMALIZERS.ffprobe,
  },
  {
    key: 'skipExisting',
    cli: {
      flags: '--skip-existing',
      help: 'skip recordings whose output already exists and matches the source',
    },
    default: false,
    normalize: OVERRIDE_NORMALIZERS.skipExisting,
  },
  {
    key: 'recurse',
    cli: { flags: '--recurse', help: 'scan input folders recursively' },
    default: false,
    normalize: OVERRIDE_NORMALIZERS.recurse,
  },
  {
    key: 'trackOut',
    cli: {
      flags: '--track-out <file>',
      help:
        'write one flight track file to <file>, format from the extension: ' +
        '.gpx, .geojson, .kml, .kmz or .json (the telemetry document; one recording per run)',
    },
    default: null,
    normalize: OVERRIDE_NORMALIZERS.trackOut,
  },
  {
    key: 'json',
    cli: { flags: '--json', help: 'print one NDJSON summary line per recording on stdout' },
    default: false,
    normalize: OVERRIDE_NORMALIZERS.json,
  },
  {
    key: 'quiet',
    cli: { flags: '-q, --quiet', help: 'suppress progress output' },
    default: false,
    normalize: OVERRIDE_NORMALIZERS.quiet,
  },
];

const CLI_NUMBER_RX = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// The deprecated spelling keeps working through the deprecation window: both
// spellings normalize into the one `trackOut` override key, use warns, and the
// spelling stays rejected once removed (the `trail`-key precedent).
export const TELEMETRY_JSON_ALIAS = {
  inputKey: 'telemetryJson',
  key: 'trackOut',
  flags: '--telemetry-json <file>',
  help: 'deprecated alias of --track-out <file>.json',
  cliWarning:
    'warning: --telemetry-json is deprecated; use --track-out <file>.json (the alias will be removed in a future version)',
  fileWarning:
    'warning: the telemetryJson key is deprecated; use trackOut (the key will be removed in a future version)',
} as const;

function cliNumber(raw: unknown): unknown {
  if (typeof raw !== 'string' || !CLI_NUMBER_RX.test(raw.trim())) return raw;
  return Number(raw);
}

export function cliDefaultOf(key: keyof RenderConfig): string | boolean {
  const row = CONFIG_OPTIONS.find((r) => r.key === key);
  if (!row) throw new Error(`unknown config key ${String(key)}`);
  const value = row.default as unknown;
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return '';
  return key === 'hud' ? formatHud(value as HudLayout) : String(value);
}

export const DEFAULT_CONFIG: RenderConfig = Object.freeze(
  Object.fromEntries(
    CONFIG_OPTIONS.map((row) => [row.key, row.default]),
  ) as unknown as RenderConfig,
);
Object.freeze(DEFAULT_CONFIG.hud);

const OVERRIDE_SHAPE = {
  ...Object.fromEntries(
    CONFIG_OPTIONS.map((row) => [row.key, z.unknown().optional()]),
  ),
  // The deprecated alias is accepted as an input spelling only; it never
  // becomes its own config key.
  [TELEMETRY_JSON_ALIAS.inputKey]: z.unknown().optional(),
} as z.ZodRawShape;

export function normalizeOverrides(
  raw: Record<string, unknown>,
  origin: string,
  onDeprecated?: (message: string) => void,
): ConfigOverrides {
  parseValue(
    strictShape(OVERRIDE_SHAPE, {
      invalid: `invalid config overrides in ${origin}`,
      unknownKey: (key) => `unknown config key ${key} in ${origin}`,
    }),
    raw,
  );
  const out: ConfigOverrides = {};
  for (const key of Object.keys(raw)) {
    if (key === TELEMETRY_JSON_ALIAS.inputKey) continue;
    const normalize = OVERRIDE_NORMALIZERS[key as keyof RenderConfig];
    const value = raw[key];
    if (value === undefined) continue;
    if (value === null && DEFAULT_CONFIG[key as keyof RenderConfig] !== null) continue;
    Object.assign(out, normalize(value, `${origin}: ${key}`));
  }
  // Both spellings at once is ambiguous and rejected; the alias alone warns
  // and lands on the canonical key.
  const aliasValue = raw[TELEMETRY_JSON_ALIAS.inputKey];
  const canonicalValue = raw[TELEMETRY_JSON_ALIAS.key];
  if (aliasValue !== undefined && canonicalValue !== undefined) {
    throw new Error(
      `${TELEMETRY_JSON_ALIAS.inputKey} and ${TELEMETRY_JSON_ALIAS.key} cannot be combined in ${origin} (use ${TELEMETRY_JSON_ALIAS.key})`,
    );
  }
  if (aliasValue !== undefined) {
    onDeprecated?.(TELEMETRY_JSON_ALIAS.fileWarning);
    Object.assign(
      out,
      OVERRIDE_NORMALIZERS.trackOut(
        aliasValue,
        `${origin}: ${TELEMETRY_JSON_ALIAS.inputKey}`,
      ),
    );
  }
  return out;
}

export function effectiveZoomOut(config: Pick<RenderConfig, 'zoom' | 'zoomOut'>): number {
  return config.zoom > 0 ? 0 : config.zoomOut;
}

const LOOK_SETTINGS_KEYS = [
  'style',
  'view',
  'zoom',
  'zoomOut',
  'hud',
  'introSec',
  'outroSec',
  'trailColor',
] as const;
const ENCODE_SETTINGS_KEYS = ['codec', 'quality', 'preset'] as const;
export const SETTINGS_KEYS = [...LOOK_SETTINGS_KEYS, ...ENCODE_SETTINGS_KEYS] as const;

export type AppearanceSettings = Pick<RenderConfig, (typeof LOOK_SETTINGS_KEYS)[number]>;
export type EncodeSettings = Pick<RenderConfig, (typeof ENCODE_SETTINGS_KEYS)[number]>;
export type SettingsPatch = Pick<RenderConfig, (typeof SETTINGS_KEYS)[number]>;

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

const SETTINGS_SHAPE = Object.fromEntries(
  SETTINGS_KEYS.map((key) => [key, z.unknown().optional()]),
) as z.ZodRawShape;

export function parseSettingsPatch(raw: unknown, origin: string): SettingsPatch {
  parseValue(
    strictShape(SETTINGS_SHAPE, {
      invalid: `invalid settings in ${origin}`,
      unknownKey: (key) => `unknown settings key ${key} in ${origin}`,
    }),
    raw,
  );
  const flat = { ...(raw as Record<string, unknown>) };
  const hud = patchHud(flat.hud, `${origin}: hud`);
  delete flat.hud;
  const patch: ConfigOverrides = { ...normalizeOverrides(flat, origin) };
  if (hud !== undefined) patch.hud = hud;
  for (const key of SETTINGS_KEYS) {
    if (patch[key] === undefined) {
      throw new Error(`missing settings key ${key} in ${origin}`);
    }
  }
  const settings = patch as SettingsPatch;
  validateRenderConfig({ ...DEFAULT_CONFIG, ...settings, hud: { ...settings.hud } });
  return settings;
}

// The pick-request flavor of look settings: its error wording is the legacy
// IPC wording, deliberately distinct from validateRenderConfig's CLI wording.
export function parseAppearanceSettings(raw: unknown): AppearanceSettings {
  const look =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { style, view, hud } = look;
  const mapStyle = parseValue(
    z.enum(MAP_STYLE_VALUES, {
      error: (issue) => `unknown map style: ${String(issue.input)}`,
    }),
    style,
  );
  const viewMode = parseValue(
    z.enum(VIEW_MODE_VALUES, {
      error: (issue) => `unknown view: ${String(issue.input)}`,
    }),
    view,
  );
  const zoom = parseValue(numberValue('zoom'), look.zoom);
  const zoomOut = parseValue(numberValue('zoom-out'), look.zoomOut);
  requireNonNegative(zoom, 'zoom must be >= 0 (0 = auto-fit)');
  requireNonNegative(zoomOut, 'zoom-out must be >= 0');
  const introSec = parseValue(numberValue('intro'), look.introSec);
  const outroSec = parseValue(numberValue('outro'), look.outroSec);
  requireNonNegative(introSec, 'intro must be 0 or more');
  requireNonNegative(outroSec, 'outro must be 0 or more');
  const trailColor = asTrailColor(look.trailColor ?? null, 'trail color');
  const chips = typeof hud === 'object' && hud !== null ? (hud as Record<string, unknown>) : {};
  return {
    style: mapStyle,
    view: viewMode,
    zoom,
    zoomOut,
    hud: { heading: !!chips.heading, alt: !!chips.alt, speed: !!chips.speed },
    introSec,
    outroSec,
    trailColor,
  };
}

export const MIN_DIMENSION = 64;

export function isValidDimensions(width: number, height: number): boolean {
  // NaN-safe: the >= form fails for NaN, where a plain < would let it pass.
  return width >= MIN_DIMENSION && height >= MIN_DIMENSION;
}

function validateDimensions(width: number, height: number): void {
  if (!isValidDimensions(width, height)) {
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

// One bounds rule for both validator wordings; the message travels with the
// call so the CLI and IPC surfaces keep their deliberately distinct text.
function isNonNegative(value: number): boolean {
  return value >= 0;
}

function requireNonNegative(value: number, message: string): void {
  if (!isNonNegative(value)) throw new Error(message);
}

function isValidWorkerCount(workers: number): boolean {
  return Number.isInteger(workers) && workers >= 1;
}

export function isValidRenderConfig(config: RenderConfig): boolean {
  return (
    isValidDimensions(config.width, config.height) &&
    isValidWorkerCount(config.workers) &&
    isNonNegative(config.zoom) &&
    isNonNegative(config.zoomOut) &&
    isNonNegative(config.introSec) &&
    isNonNegative(config.outroSec) &&
    config.outSuffix !== ''
  );
}

export function validateRenderConfig(config: RenderConfig): void {
  validateDimensions(config.width, config.height);
  if (!isValidWorkerCount(config.workers)) {
    throw new Error('workers must be a positive integer');
  }
  requireNonNegative(config.zoom, 'zoom must be >= 0 (0 = auto-fit)');
  requireNonNegative(config.zoomOut, 'zoom-out must be >= 0');
  if (!isNonNegative(config.introSec) || !isNonNegative(config.outroSec)) {
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

function assertValidFrameRange(range: FrameRange, name = 'frame range'): void {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new Error(`invalid ${name}: start and end must be integer frame indices`);
  }
  // A single-frame span (start === end) is a valid export range.
  if (range.start < 0 || range.start > range.end) {
    throw new Error(`invalid ${name}: expected 0 <= start <= end, got ${range.start}-${range.end}`);
  }
}

export function parseFrameRange(raw: unknown, name = 'frame range'): FrameRange {
  const range = parseValue(
    strictShape(
      {
        start: numberValue(`${name}: start`),
        end: numberValue(`${name}: end`),
      },
      {
        invalid: `invalid ${name}`,
        unknownKey: (key) => `unknown ${name} key ${key}`,
      },
    ),
    raw,
  );
  assertValidFrameRange(range, name);
  return range;
}

export function resolveFrameRange(
  range: FrameRange | null | undefined,
  frames: number,
): FrameRange | null {
  if (!range) return null;
  assertValidFrameRange(range);
  if (range.end >= frames) {
    throw new Error(
      `frame range ${range.start}-${range.end} is beyond the recording (${frames} frames)`,
    );
  }
  return range;
}

const MAIN_OWNED_KEYS = [
  // TELEMETRY_JSON_ALIAS.inputKey stays stripped as a legacy spelling of
  // trackOut, so neither spelling can leak into an export request's config.
  'outDir', 'outSuffix', 'tileCache', 'browser', 'ffmpeg', 'ffprobe', 'workers', 'capture',
  'skipExisting', 'recurse', 'trackOut', TELEMETRY_JSON_ALIAS.inputKey, 'json', 'quiet',
] as const;

function parseRequestConfig(raw: unknown, base: RenderConfig): RenderConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid export request: config');
  }
  const flat = { ...(raw as Record<string, unknown>) };
  for (const key of MAIN_OWNED_KEYS) delete flat[key];
  const { hud, ...rest } = flat;
  const hudSpec =
    hud === undefined || hud === null
      ? undefined
      : parseValue(hudSpecSchema('export request: config: hud'), hud);
  const config = { ...base, ...normalizeOverrides(rest, 'export request: config') };
  const merged = hudSpec === undefined ? config : { ...config, hud: hudSpec };
  validateRenderConfig(merged);
  return { ...merged, ...normalizeDimensions(merged.width, merged.height) };
}

const EXPORT_REQUEST_SCHEMA = z.preprocess(
  keyedObjectInput,
  strictShape(
    {
      outPath: z.unknown().optional(),
      config: z.unknown().optional(),
      range: z.unknown().optional(),
    },
    {
      invalid: 'invalid export request',
      unknownKey: (key) => `unknown export request key ${key}`,
    },
  ),
);

export function parseExportRequest(raw: unknown, base: RenderConfig): ExportRequest {
  const request = parseValue(EXPORT_REQUEST_SCHEMA, raw);
  const outPath = parseValue(stringValue('export request: outPath'), request.outPath);
  if (!outPath.toLowerCase().endsWith('.mp4')) {
    throw new Error(`export request: outPath must be an .mp4 file: ${outPath}`);
  }
  const range =
    request.range === undefined || request.range === null
      ? null
      : parseFrameRange(request.range);
  return { outPath, config: parseRequestConfig(request.config, base), range };
}
