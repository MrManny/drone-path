import { describe, expect, it } from 'vitest';

import {
  CONFIG_OPTIONS,
  DEFAULT_CONFIG,
  OVERRIDE_NORMALIZERS,
  SETTINGS_KEYS,
  asTrailColor,
  cliDefaultOf,
  formatHud,
  normalizeDimensions,
  normalizeOverrides,
  parseExportRequest,
  parseFrameRange,
  parseHud,
  parseSettingsPatch,
  resolveHudLayout,
  validateRenderConfig,
} from '../src/config.js';

describe('normalizeDimensions', () => {
  it.each([
    ['an even canvas stays as-is', 768, 500, 768, 500],
    ['odd sizes round down to even', 767, 501, 766, 500],
    ['fractional sizes round down', 640.9, 100.5, 640, 100],
    ['the minimum canvas is kept', 64, 65, 64, 64],
  ])('%s', (_label, width, height, wantWidth, wantHeight) => {
    expect(normalizeDimensions(width, height)).toEqual({
      width: wantWidth,
      height: wantHeight,
    });
  });
});

describe('parseHud', () => {
  it('parses comma lists', () => {
    expect(parseHud('heading,alt')).toEqual({
      heading: true,
      alt: true,
      speed: false,
    });
  });

  it('parses none', () => {
    expect(parseHud('none')).toEqual({
      heading: false,
      alt: false,
      speed: false,
    });
  });

  it('rejects unknown components', () => {
    expect(() => parseHud('heading,bogus')).toThrow(/unknown --hud component/);
  });
});

describe('normalizeOverrides', () => {
  it('normalizes typed values for known keys', () => {
    expect(
      normalizeOverrides(
        { zoom: 5, hud: 'heading,alt', skipExisting: true },
        'test',
      ),
    ).toEqual({
      zoom: 5,
      hud: { heading: true, alt: true, speed: false },
      skipExisting: true,
    });
  });

  it.for(['5', '', '0x10'])('rejects the string number %s in a typed layer', (value) => {
    expect(() => normalizeOverrides({ zoom: value }, 'test')).toThrow(
      /invalid number for test: zoom/,
    );
  });

  it('rejects unknown keys', () => {
    expect(() => normalizeOverrides({ bogus: 1 }, 'test')).toThrow(
      /unknown config key/,
    );
  });

  it('skips null and undefined values', () => {
    expect(normalizeOverrides({ outDir: null, zoom: undefined }, 'test')).toEqual({});
  });

  it('carries an explicit null for keys whose default is null (a reset to default)', () => {
    expect(normalizeOverrides({ trailColor: null, browser: null }, 'test')).toEqual({
      trailColor: null,
      browser: null,
    });
    expect(normalizeOverrides({ zoom: null }, 'test')).toEqual({});
  });

  it('normalizes the telemetry JSON path as a nullable string', () => {
    expect(normalizeOverrides({ telemetryJson: 'telemetry.json' }, 'test')).toEqual({
      telemetryJson: 'telemetry.json',
    });
    expect(normalizeOverrides({ telemetryJson: '' }, 'test')).toEqual({
      telemetryJson: null,
    });
    expect(() => normalizeOverrides({ telemetryJson: 5 }, 'test')).toThrow(
      /invalid value for test: telemetryJson/,
    );
  });

  it.each([
    ['NaN', NaN, 'invalid number for test: zoom: NaN'],
    ['Infinity', Infinity, 'invalid number for test: zoom: Infinity'],
  ] as Array<[string, number, string]>)(
    'rejects %s with the legacy number wording',
    (_label, value, message) => {
      expect(() => normalizeOverrides({ zoom: value }, 'test')).toThrow(message);
    },
  );

  it('names every accepted choice for an invalid enum value', () => {
    expect(() => normalizeOverrides({ quality: 'ultra' }, 'test')).toThrow(
      'invalid value for test: quality: ultra (use near-lossless | high | medium | low)',
    );
  });
});

describe('asTrailColor', () => {
  it.each([
    ['#e63946', '#e63946'],
    ['41f0ff', '#41f0ff'],
    ['#E63946', '#e63946'],
    ['#f00', '#ff0000'],
    ['#f00c', '#ff0000cc'],
    ['#41f0ffcc', '#41f0ffcc'],
    ['', null],
    [null, null],
  ] as Array<[unknown, string | null]>)('canonicalizes %s', (raw, want) => {
    expect(asTrailColor(raw, 'trail color')).toBe(want);
  });

  it.each([['neon'], ['#12345'], ['rgb(1,2,3)'], ['#gggggg'], ['#e63946ee00'], [5], [true]])(
    'rejects %s with one clear error naming the flag',
    (raw) => {
      expect(() => asTrailColor(raw, '--trail-color')).toThrow(
        /invalid value for --trail-color: .* \(use hex like #e63946 or #e63946cc\)/,
      );
    },
  );

  it.for([' neon ', ' ', '#12345 '])(
    'echoes the raw untrimmed input in the error',
    (raw) => {
      expect(() => asTrailColor(raw, '--trail-color')).toThrow(
        `invalid value for --trail-color: ${raw} (use hex like #e63946 or #e63946cc)`,
      );
    },
  );

  it('canonicalizes a padded value after trimming', () => {
    expect(asTrailColor(' #f00 ', 'trail color')).toBe('#ff0000');
  });
});

describe('validateRenderConfig', () => {
  it('accepts the built-in defaults', () => {
    expect(() => validateRenderConfig({ ...DEFAULT_CONFIG })).not.toThrow();
  });

  it.for([
    { name: 'zero workers', patch: { workers: 0 } },
    { name: 'tiny width', patch: { width: 10 } },
    { name: 'negative zoom', patch: { zoom: -1 } },
    { name: 'negative zoom-out', patch: { zoomOut: -1 } },
    { name: 'negative intro', patch: { introSec: -1 } },
    { name: 'negative outro', patch: { outroSec: -1 } },
    { name: 'empty out-suffix', patch: { outSuffix: '' } },
    { name: 'NaN zoom', patch: { zoom: NaN } },
  ])('rejects $name', ({ patch }) => {
    expect(() =>
      validateRenderConfig({ ...DEFAULT_CONFIG, ...patch }),
    ).toThrow();
  });
});

describe('CONFIG_OPTIONS', () => {
  const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof typeof DEFAULT_CONFIG)[];

  it('covers every config key exactly once', () => {
    const keys = CONFIG_OPTIONS.map((row) => row.key);
    expect([...keys].sort()).toEqual([...CONFIG_KEYS].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps one normalizer per config key', () => {
    expect(Object.keys(OVERRIDE_NORMALIZERS).sort()).toEqual([...CONFIG_KEYS].sort());
  });

  it('derives DEFAULT_CONFIG from the table', () => {
    for (const row of CONFIG_OPTIONS) {
      expect(DEFAULT_CONFIG[row.key]).toEqual(row.default);
    }
  });

  it('produces a default config that passes validation', () => {
    expect(() => validateRenderConfig({ ...DEFAULT_CONFIG })).not.toThrow();
  });

  it('round-trips every default through its own normalizer', () => {
    for (const row of CONFIG_OPTIONS) {
      const cliValue = cliDefaultOf(row.key);
      if (row.key === 'tileCache') {
        expect(() => row.normalize(cliValue, row.key)).toThrow();
        continue;
      }
      const raw = row.cli.parse ? row.cli.parse(cliValue) : cliValue;
      expect(row.normalize(raw, row.key)).toEqual({ [row.key]: row.default });
    }
  });
  it('spells each flag as a long option with a help text', () => {
    for (const row of CONFIG_OPTIONS) {
      expect(row.cli.flags).toMatch(/--[a-z-]+/);
      expect(row.cli.help.length).toBeGreaterThan(0);
    }
  });

  it('keeps the enum defaults inside the accepted choices', () => {
    for (const row of CONFIG_OPTIONS) {
      if (!row.cli.choices) continue;
      expect(row.cli.choices).toContain(row.default);
    }
  });

  it('rejects an unknown key', () => {
    expect(() => cliDefaultOf('bogus' as keyof typeof DEFAULT_CONFIG)).toThrow(
      /unknown config key/,
    );
  });
});

describe('resolveHudLayout', () => {
  it('keeps the alt chip when the telemetry has altitude', () => {
    const hud = { heading: true, alt: true, speed: false };
    expect(resolveHudLayout(hud, true)).toEqual(hud);
  });

  it('drops the alt chip when the telemetry has no altitude', () => {
    expect(
      resolveHudLayout({ heading: true, alt: true, speed: true }, false),
    ).toEqual({ heading: true, alt: false, speed: true });
  });

  it('leaves the other chips untouched when alt is already off', () => {
    const hud = { heading: true, alt: false, speed: true };
    expect(resolveHudLayout(hud, false)).toEqual(hud);
  });
});

describe('formatHud', () => {
  it('round-trips through parseHud', () => {
    for (const list of ['heading', 'heading,alt', 'alt,speed', 'heading,alt,speed', 'none']) {
      expect(formatHud(parseHud(list))).toBe(list);
    }
  });
});

describe('parseFrameRange', () => {
  it('accepts an inclusive start < end range', () => {
    expect(parseFrameRange({ start: 10, end: 29 })).toEqual({ start: 10, end: 29 });
  });

  it.each([
    ['start equal to end', { start: 5, end: 5 }],
    ['start after end', { start: 9, end: 2 }],
    ['negative start', { start: -1, end: 4 }],
    ['fractional index', { start: 1.5, end: 4 }],
    ['non-numeric end', { start: 0, end: 'x' }],
    ['unknown key', { start: 0, end: 4, fps: 30 }],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseFrameRange(raw)).toThrow(/invalid|unknown/);
  });

  it('rejects non-object input', () => {
    expect(() => parseFrameRange(null)).toThrow('invalid frame range');
    expect(() => parseFrameRange([0, 4])).toThrow('invalid frame range');
  });
});

describe('parseExportRequest', () => {
  const base = { ...DEFAULT_CONFIG, outDir: null, tileCache: '/cache' };
  const validConfig = { width: 1280, height: 720, style: 'topo', hud: { heading: true, alt: true, speed: false } };

  it('builds the snapshot on top of the base config, with the range', () => {
    const request = parseExportRequest(
      { outPath: '/exports/flight_map.mp4', config: validConfig, range: { start: 4, end: 9 } },
      base,
    );
    expect(request.outPath).toBe('/exports/flight_map.mp4');
    expect(request.range).toEqual({ start: 4, end: 9 });
    expect(request.config).toMatchObject({ width: 1280, height: 720, style: 'topo', tileCache: '/cache' });
    expect(request.config.hud).toEqual({ heading: true, alt: true, speed: false });
  });

  it('treats a missing or null range as the full recording', () => {
    expect(parseExportRequest({ outPath: '/x/a.mp4', config: {} }, base).range).toBeNull();
    expect(parseExportRequest({ outPath: '/x/a.mp4', config: {}, range: null }, base).range).toBeNull();
  });

  it('normalizes odd dimensions to the effective even canvas', () => {
    const request = parseExportRequest(
      { outPath: '/x/a.mp4', config: { width: 641, height: 767 } },
      base,
    );
    expect(request.config.width).toBe(640);
    expect(request.config.height).toBe(766);
  });

  it.each([
    ['a non-mp4 path', { outPath: '/x/a.mov', config: {} }, /must be an \.mp4/],
    ['an unknown top-level key', { outPath: '/x/a.mp4', config: {}, extra: 1 }, /unknown export request key/],
    ['a missing config', { outPath: '/x/a.mp4' }, /invalid export request: config/],
    ['an unknown config key', { outPath: '/x/a.mp4', config: { bogus: 1 } }, /unknown config key bogus/],
    ['a too-small width', { outPath: '/x/a.mp4', config: { width: 32 } }, /at least 64/],
    ['a string width', { outPath: '/x/a.mp4', config: { width: '640' } }, /invalid number for export request: config: width/],
    ['a malformed hud object', { outPath: '/x/a.mp4', config: { hud: { heading: 'yes' } } }, /heading/],
    ['an invalid range', { outPath: '/x/a.mp4', config: {}, range: { start: 8, end: 3 } }, /invalid/],
  ])('rejects %s', (_label, raw, pattern) => {
    expect(() => parseExportRequest(raw, base)).toThrow(pattern);
  });

  it('rejects a non-object request', () => {
    expect(() => parseExportRequest('nope', base)).toThrow('invalid export request');
  });

  it.each([
    ['an index-keyed array request', ['x'], 'unknown export request key 0'],
    ['an empty array request', [], 'invalid value for export request: outPath: undefined'],
  ] as Array<[string, unknown, string]>)('rejects %s through the key rule', (_label, raw, message) => {
    expect(() => parseExportRequest(raw, base)).toThrow(message);
  });

  it('treats an array HUD in the export config like an object with index keys', () => {
    expect(() =>
      parseExportRequest({ outPath: '/x/a.mp4', config: { hud: ['heading'] } }, base),
    ).toThrow('unknown key 0 in export request: config: hud');
    expect(() =>
      parseExportRequest({ outPath: '/x/a.mp4', config: { hud: [] } }, base),
    ).toThrow('invalid value for export request: config: hud: heading: undefined');
  });
});

describe('export request boundary', () => {
  const base = { ...DEFAULT_CONFIG, outDir: '/recs', tileCache: '/main/cache', browser: null, workers: 4 };
  const modalSnapshot = { ...DEFAULT_CONFIG, width: 768, height: 768, tileCache: '' };

  it('accepts the modal payload and keeps the segment range intact', () => {
    const payload = JSON.parse(
      JSON.stringify({
        outPath: '/exports/seg.mp4',
        config: modalSnapshot,
        range: { start: 100, end: 250 },
      }),
    );
    const request = parseExportRequest(payload, base);
    expect(request.range).toEqual({ start: 100, end: 250 });
    expect(request.config.width).toBe(768);
  });

  it('keeps the main process tile cache even when the snapshot carries an empty one', () => {
    const request = parseExportRequest(
      { outPath: '/exports/a.mp4', config: { tileCache: '' } },
      base,
    );
    expect(request.config.tileCache).toBe('/main/cache');
  });

  it('ignores renderer-supplied machine settings', () => {
    const request = parseExportRequest(
      {
        outPath: '/exports/a.mp4',
        config: {
          tileCache: '/attacker', browser: '/evil.exe', workers: 64, outDir: '/elsewhere',
          ffmpeg: '/evil/ffmpeg', ffprobe: '/evil/ffprobe', telemetryJson: '/evil/telemetry.json',
        },
      },
      base,
    );
    expect(request.config).toMatchObject({
      tileCache: '/main/cache', browser: null, workers: 4, outDir: '/recs',
      ffmpeg: null, ffprobe: null, telemetryJson: null,
    });
  });

  it('still applies renderer-owned look and dimension settings', () => {
    const request = parseExportRequest(
      { outPath: '/exports/a.mp4', config: { style: 'topo', width: 1024, height: 576 } },
      base,
    );
    expect(request.config).toMatchObject({ style: 'topo', width: 1024, height: 576 });
  });

  it('applies a renderer-owned trail color and lets null reset it to the default', () => {
    const coloredBase = { ...base, trailColor: '#e63946' };
    const applied = parseExportRequest(
      { outPath: '/exports/a.mp4', config: { trailColor: '#41f0ff' } },
      coloredBase,
    );
    expect(applied.config.trailColor).toBe('#41f0ff');
    const reset = parseExportRequest(
      { outPath: '/exports/a.mp4', config: { trailColor: null } },
      coloredBase,
    );
    expect(reset.config.trailColor).toBeNull();
  });

  it('still applies renderer-owned encoder settings', () => {
    const request = parseExportRequest(
      {
        outPath: '/exports/a.mp4',
        config: { codec: 'h265', quality: 'low', preset: 'veryfast' },
      },
      base,
    );
    expect(request.config).toMatchObject({ codec: 'h265', quality: 'low', preset: 'veryfast' });
  });
});

describe('parseSettingsPatch', () => {
  const complete = {
    style: 'topo',
    view: 'overview',
    zoom: 16,
    zoomOut: 2,
    hud: { heading: true, alt: false, speed: true },
    introSec: 1.5,
    outroSec: 0,
    trailColor: null,
    codec: 'h265',
    quality: 'low',
    preset: 'veryfast',
  };

  it('accepts the object HUD form the renderer sends', () => {
    expect(parseSettingsPatch(complete, 'test')).toEqual(complete);
  });

  it('accepts a chosen trail color and canonicalizes it', () => {
    const withColor = { ...complete, trailColor: '#41f0ff' };
    expect(parseSettingsPatch(withColor, 'test')).toEqual(withColor);
    expect(parseSettingsPatch({ ...complete, trailColor: '41FF00CC' }, 'test')).toEqual({
      ...complete,
      trailColor: '#41ff00cc',
    });
  });

  it('accepts the CLI-string HUD form JSON files use', () => {
    expect(parseSettingsPatch({ ...complete, hud: 'heading,speed' }, 'test')).toEqual(complete);
  });

  it.each([
    ['a non-object', null],
    ['an array', [complete]],
    ['an unknown key', { ...complete, bogus: 1 }],
    ['a known config key outside the panel', { ...complete, outDir: 'x' }],
    ['a machine-owned key', { ...complete, tileCache: 'D:\\cache' }],
    ['a tool override key', { ...complete, ffmpeg: 'D:\\ff\\ffmpeg.exe' }],
    ['a missing key', { style: 'topo', view: 'follow', zoom: 0, zoomOut: 1, hud: 'none', introSec: 2 }],
    ['an invalid enum', { ...complete, style: 'neon' }],
    ['an unknown codec', { ...complete, codec: 'av1' }],
    ['an unknown quality', { ...complete, quality: 'ultra' }],
    ['an unknown preset', { ...complete, preset: 'slow' }],
    ['a string number', { ...complete, zoom: '16' }],
    ['a malformed hud object', { ...complete, hud: { heading: 'yes' } }],
    ['an unknown hud component', { ...complete, hud: 'heading,bogus' }],
    ['a look value the pipeline would reject', { ...complete, zoom: -1 }],
    ['a mistyped flag', { ...complete, outroSec: '2' }],
    ['an unreadable trail color', { ...complete, trailColor: 'neon' }],
    ['a mistyped trail color', { ...complete, trailColor: 5 }],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseSettingsPatch(raw, 'test')).toThrow();
  });

  it.for(SETTINGS_KEYS)('rejects a patch missing %s', (key) => {
    const partial: Record<string, unknown> = { ...complete };
    delete partial[key];
    expect(() => parseSettingsPatch(partial, 'test')).toThrow(
      `missing settings key ${key} in test`,
    );
  });

  it('echoes the raw trail color input in the error', () => {
    expect(() => parseSettingsPatch({ ...complete, trailColor: ' neon ' }, 'test')).toThrow(
      'invalid value for test: trailColor:  neon  (use hex like #e63946 or #e63946cc)',
    );
  });

  it.each([
    ['an index-keyed array', ['heading'], 'unknown key 0 in test: hud'],
    ['an empty array', [], 'invalid value for test: hud: heading: undefined'],
  ] as Array<[string, unknown, string]>)('rejects %s HUD like the object form', (_label, hud, message) => {
    expect(() => parseSettingsPatch({ ...complete, hud }, 'test')).toThrow(message);
  });
});
