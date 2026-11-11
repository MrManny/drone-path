import { z } from 'zod';

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

export function numberValue(name: string): z.ZodType<number> {
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

function hudSpecSchema(name: string): z.ZodType<HudSpec> {
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

function patchHud(value: unknown, name: string): HudSpec | undefined {
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
  normalize: OverrideNormalizer;
}

export const CONFIG_OPTIONS: readonly ConfigOption[] = [
  {
    key: 'outDir',
    cli: { flags: '--out-dir <dir>', help: 'output folder' },
    default: 'out',
    normalize: (v, name) => ({ outDir: parseValue(nullableStringValue(name), v) }),
  },
  {
    key: 'outSuffix',
    cli: { flags: '--out-suffix <suffix>', help: 'output name = <basename><suffix>.mp4' },
    default: '_map',
    normalize: (v, name) => ({ outSuffix: parseValue(stringValue(name), v) }),
  },
  {
    key: 'width',
    cli: { flags: '--width <px>', help: 'canvas width in pixels (rounded down to even)', parse: cliNumber },
    default: 768,
    normalize: (v, name) => ({ width: parseValue(numberValue(name), v) }),
  },
  {
    key: 'height',
    cli: { flags: '--height <px>', help: 'canvas height in pixels (rounded down to even)', parse: cliNumber },
    default: 768,
    normalize: (v, name) => ({ height: parseValue(numberValue(name), v) }),
  },
  {
    key: 'style',
    cli: { flags: '--style <name>', help: 'map look', choices: STYLE_VALUES },
    default: 'satellite',
    normalize: (v, name) => ({ style: parseValue(enumValue(name, STYLE_VALUES), v) }),
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
    normalize: (v, name) => ({ view: parseValue(enumValue(name, VIEW_VALUES), v) }),
  },
  {
    key: 'zoom',
    cli: { flags: '--zoom <n>', help: 'fixed view zoom level (0 = auto-fit to the track)', parse: cliNumber },
    default: 0,
    normalize: (v, name) => ({ zoom: parseValue(numberValue(name), v) }),
  },
  {
    key: 'zoomOut',
    cli: { flags: '--zoom-out <n>', help: 'auto-fit only: pull back n zoom levels', parse: cliNumber },
    default: 1,
    normalize: (v, name) => ({ zoomOut: parseValue(numberValue(name), v) }),
  },
  {
    key: 'introSec',
    cli: { flags: '--intro-sec <s>', help: 'intro: zoom in from one level out over s seconds', parse: cliNumber },
    default: 2,
    normalize: (v, name) => ({ introSec: parseValue(numberValue(name), v) }),
  },
  {
    key: 'outroSec',
    cli: { flags: '--outro-sec <s>', help: 'outro: zoom back out over s seconds', parse: cliNumber },
    default: 2,
    normalize: (v, name) => ({ outroSec: parseValue(numberValue(name), v) }),
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
    normalize: (v, name) => ({ hud: parseHud(parseValue(stringValue(name), v)) }),
  },
  {
    key: 'workers',
    cli: { flags: '--workers <n>', help: 'parallel browser pages', parse: cliNumber },
    default: 4,
    normalize: (v, name) => ({ workers: parseValue(numberValue(name), v) }),
  },
  {
    key: 'capture',
    cli: { flags: '--capture <mode>', help: 'frame capture mode (canvas is parked)', choices: CAPTURE_VALUES },
    default: 'jpeg',
    normalize: (v, name) => ({ capture: parseValue(enumValue(name, CAPTURE_VALUES), v) }),
  },
  {
    key: 'codec',
    cli: { flags: '--codec <name>', help: 'video codec (mp4 container)', choices: CODEC_VALUES },
    default: 'h264',
    normalize: (v, name) => ({ codec: parseValue(enumValue(name, CODEC_VALUES), v) }),
  },
  {
    key: 'quality',
    cli: { flags: '--quality <level>', help: 'encoding quality', choices: QUALITY_VALUES },
    default: 'high',
    normalize: (v, name) => ({ quality: parseValue(enumValue(name, QUALITY_VALUES), v) }),
  },
  {
    key: 'preset',
    cli: { flags: '--preset <name>', help: 'encoding speed', choices: PRESET_VALUES },
    default: 'medium',
    normalize: (v, name) => ({ preset: parseValue(enumValue(name, PRESET_VALUES), v) }),
  },
  {
    key: 'tileCache',
    cli: { flags: '--tile-cache <dir>', help: 'tile cache directory (default: per-user cache dir)' },
    default: '',
    normalize: (v, name) => ({ tileCache: parseValue(stringValue(name), v) }),
  },
  {
    key: 'browser',
    cli: { flags: '--browser <path>', help: 'Chromium/Chrome/Edge executable (default: system Chrome/Edge)' },
    default: null,
    normalize: (v, name) => ({ browser: parseValue(nullableStringValue(name), v) }),
  },
  {
    key: 'ffmpeg',
    cli: { flags: '--ffmpeg <path>', help: 'ffmpeg executable (default: embedded binary, then PATH)' },
    default: null,
    normalize: (v, name) => ({ ffmpeg: parseValue(nullableStringValue(name), v) }),
  },
  {
    key: 'ffprobe',
    cli: { flags: '--ffprobe <path>', help: 'ffprobe executable (default: embedded binary, then PATH)' },
    default: null,
    normalize: (v, name) => ({ ffprobe: parseValue(nullableStringValue(name), v) }),
  },
  {
    key: 'skipExisting',
    cli: {
      flags: '--skip-existing',
      help: 'skip recordings whose output already exists and matches the source',
    },
    default: false,
    normalize: (v, name) => ({ skipExisting: parseValue(boolValue(name), v) }),
  },
  {
    key: 'recurse',
    cli: { flags: '--recurse', help: 'scan input folders recursively' },
    default: false,
    normalize: (v, name) => ({ recurse: parseValue(boolValue(name), v) }),
  },
  {
    key: 'telemetryJson',
    cli: {
      flags: '--telemetry-json <file>',
      help: 'write one JSON document with per-frame telemetry to <file> (one recording per run)',
    },
    default: null,
    normalize: (v, name) => ({ telemetryJson: parseValue(nullableStringValue(name), v) }),
  },
  {
    key: 'json',
    cli: { flags: '--json', help: 'print one NDJSON summary line per recording on stdout' },
    default: false,
    normalize: (v, name) => ({ json: parseValue(boolValue(name), v) }),
  },
  {
    key: 'quiet',
    cli: { flags: '-q, --quiet', help: 'suppress progress output' },
    default: false,
    normalize: (v, name) => ({ quiet: parseValue(boolValue(name), v) }),
  },
];

const CLI_NUMBER_RX = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

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

const OVERRIDE_SHAPE = Object.fromEntries(
  CONFIG_OPTIONS.map((row) => [row.key, z.unknown().optional()]),
) as z.ZodRawShape;

export function normalizeOverrides(
  raw: Record<string, unknown>,
  origin: string,
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
    const normalize = OVERRIDE_NORMALIZERS[key as keyof RenderConfig];
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

// The pick-request flavor of look settings. Its error wording is the legacy
// IPC wording the renderer has always shown; it predates validateRenderConfig
// and intentionally stays distinct from the CLI wording.
export function parseLookSettings(raw: unknown): LookSettings {
  const look =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { style, view, hud } = look;
  const mapStyle = parseValue(
    z.enum(STYLE_VALUES, {
      error: (issue) => `unknown map style: ${String(issue.input)}`,
    }),
    style,
  );
  const viewMode = parseValue(
    z.enum(VIEW_VALUES, {
      error: (issue) => `unknown view: ${String(issue.input)}`,
    }),
    view,
  );
  const zoom = parseValue(numberValue('zoom'), look.zoom);
  const zoomOut = parseValue(numberValue('zoom-out'), look.zoomOut);
  if (!(zoom >= 0)) throw new Error('zoom must be >= 0 (0 = auto-fit)');
  if (!(zoomOut >= 0)) throw new Error('zoom-out must be >= 0');
  const introSec = parseValue(numberValue('intro'), look.introSec);
  const outroSec = parseValue(numberValue('outro'), look.outroSec);
  if (!(introSec >= 0)) throw new Error('intro must be 0 or more');
  if (!(outroSec >= 0)) throw new Error('outro must be 0 or more');
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
