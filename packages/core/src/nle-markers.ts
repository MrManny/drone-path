import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Fps } from './frametime.js';

export type MarkerFormat = 'csv' | 'fcpxml';

export interface MarkerRange {
  clipPath: string;
  clipName?: string;
  fps: Fps;
  durationSec: number;
  startSec: number;
  endSec: number;
  label: string;
  note?: string;
  color?: string;
}

const RESOLVE_CSV_HEADER = '#,Clip Name,In,Out,Duration,Marker Color,Marker Name,Notes';
const DEFAULT_MARKER_COLOR = 'Blue';
const DEFAULT_FPS: Fps = { num: 30, den: 1, value: 30, str: '30' };

export function markerFormatOf(filePath: string): MarkerFormat {
  const match = /\.([^.\\/]+)$/u.exec(filePath);
  const ext = match ? match[1].toLowerCase() : '';
  if (ext === 'csv') return 'csv';
  if (ext === 'fcpxml') return 'fcpxml';
  throw new Error('expected a .csv or .fcpxml output file');
}

function validateMarkerRange(marker: MarkerRange): void {
  if (marker.clipPath.trim() === '') {
    throw new Error('marker clipPath must not be empty');
  }
  if (marker.label.trim() === '') {
    throw new Error('marker label must not be empty');
  }
  if (!Number.isFinite(marker.durationSec) || marker.durationSec <= 0) {
    throw new Error('marker durationSec must be positive');
  }
  if (
    !Number.isFinite(marker.fps.value) ||
    marker.fps.value <= 0 ||
    !Number.isInteger(marker.fps.num) ||
    marker.fps.num <= 0 ||
    !Number.isInteger(marker.fps.den) ||
    marker.fps.den <= 0
  ) {
    throw new Error('marker fps must be positive');
  }
  if (
    !Number.isFinite(marker.startSec) ||
    !Number.isFinite(marker.endSec) ||
    marker.startSec < 0 ||
    marker.startSec > marker.endSec ||
    marker.endSec > marker.durationSec
  ) {
    throw new Error('marker range must satisfy 0 <= startSec <= endSec <= durationSec');
  }
}

function clipNameOf(marker: MarkerRange): string {
  const trimmed = marker.clipName?.trim();
  if (trimmed) return trimmed;
  const base = marker.clipPath.split(/[\\/]/u).at(-1);
  return base && base.length > 0 ? base : marker.clipPath;
}

function nonEmptyOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function framesToSmpte(frames: number, tcBase: number): string {
  const ff = frames % tcBase;
  const totalSec = Math.floor(frames / tcBase);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
}

function escapeCsvCell(raw: string, guardFormula: boolean): string {
  // Prefix spreadsheet formula triggers with an apostrophe to neutralize CSV formula injection.
  const safe = guardFormula && /^[=+\-@\t\r]/u.test(raw) ? `'${raw}` : raw;
  if (!/[",\r\n]/u.test(safe)) return safe;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function serializeDaVinciResolveCsv(markers: readonly MarkerRange[]): string {
  const lines = [RESOLVE_CSV_HEADER];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    validateMarkerRange(marker);
    const tcBase = Math.max(1, Math.round(marker.fps.value));
    const inFrames = Math.round(marker.startSec * marker.fps.value);
    const outFrames = Math.round(marker.endSec * marker.fps.value);
    const durFrames = Math.max(0, outFrames - inFrames);
    const row = [
      escapeCsvCell(String(i + 1), false),
      escapeCsvCell(clipNameOf(marker), true),
      escapeCsvCell(framesToSmpte(inFrames, tcBase), false),
      escapeCsvCell(framesToSmpte(outFrames, tcBase), false),
      escapeCsvCell(framesToSmpte(durFrames, tcBase), false),
      escapeCsvCell(nonEmptyOr(marker.color, DEFAULT_MARKER_COLOR), true),
      escapeCsvCell(marker.label, true),
      escapeCsvCell(marker.note ?? '', true),
    ];
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function rationalTime(frames: number, fps: Fps): string {
  if (frames === 0) return '0s';
  const num = frames * fps.den;
  const den = fps.num;
  const factor = gcd(num, den);
  return `${num / factor}/${den / factor}s`;
}

function frameDurationAttr(fps: Fps): string {
  const factor = gcd(fps.den, fps.num);
  return `${fps.den / factor}/${fps.num / factor}s`;
}

function escapeXml(raw: string): string {
  // Strip ASCII control characters disallowed by XML 1.0 before entity escaping.
  let clean = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20) {
      clean += ch;
    }
  }
  return clean
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function fileUrlOf(clipPath: string): string {
  return pathToFileURL(path.resolve(clipPath)).href;
}

export function serializeFcpxmlMarkers(markers: readonly MarkerRange[]): string {
  for (const marker of markers) validateMarkerRange(marker);

  const formatIds = new Map<string, { id: string; fps: Fps; frameDuration: string }>();
  const assetIds = new Map<
    string,
    { id: string; name: string; src: string; duration: string; formatId: string }
  >();

  let nextId = 1;
  const allocId = () => `r${nextId++}`;

  const ensureFormat = (fps: Fps): string => {
    const frameDuration = frameDurationAttr(fps);
    const existing = formatIds.get(frameDuration);
    if (existing) return existing.id;
    const id = allocId();
    formatIds.set(frameDuration, { id, fps, frameDuration });
    return id;
  };

  if (markers.length === 0) {
    ensureFormat(DEFAULT_FPS);
  } else {
    for (const marker of markers) ensureFormat(marker.fps);
  }

  for (const marker of markers) {
    const formatId = ensureFormat(marker.fps);
    const resolvedKey = path.resolve(marker.clipPath);
    if (!assetIds.has(resolvedKey)) {
      const assetFrames = Math.max(1, Math.round(marker.durationSec * marker.fps.value));
      assetIds.set(resolvedKey, {
        id: allocId(),
        name: clipNameOf(marker),
        src: fileUrlOf(marker.clipPath),
        duration: rationalTime(assetFrames, marker.fps),
        formatId,
      });
    }
  }

  const seqFps = markers[0]?.fps ?? DEFAULT_FPS;
  const seqFormatId = ensureFormat(seqFps);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.10">',
    '  <resources>',
  ];

  for (const fmt of formatIds.values()) {
    lines.push(
      `    <format id="${fmt.id}" name="FFVideoFormatRateUndefined" frameDuration="${fmt.frameDuration}"/>`,
    );
  }
  for (const asset of assetIds.values()) {
    lines.push(
      `    <asset id="${asset.id}" name="${escapeXml(asset.name)}" src="${escapeXml(asset.src)}" start="0s" duration="${asset.duration}" hasVideo="1" format="${asset.formatId}"/>`,
    );
  }

  const spineLines: string[] = [];
  let timelineOffsetFrames = 0;

  for (const marker of markers) {
    const formatId = ensureFormat(marker.fps);
    const asset = assetIds.get(path.resolve(marker.clipPath))!;
    const inFrames = Math.round(marker.startSec * marker.fps.value);
    const outFrames = Math.round(marker.endSec * marker.fps.value);
    const clipFrames = Math.max(1, outFrames - inFrames);
    const startAttr = rationalTime(inFrames, marker.fps);
    const clipDurAttr = rationalTime(clipFrames, marker.fps);
    const markerDurAttr = rationalTime(Math.max(0, outFrames - inFrames), marker.fps);
    const offsetAttr = rationalTime(timelineOffsetFrames, seqFps);
    const noteAttr = marker.note ? ` note="${escapeXml(marker.note)}"` : '';

    spineLines.push(
      `          <asset-clip ref="${asset.id}" offset="${offsetAttr}" name="${escapeXml(clipNameOf(marker))}" start="${startAttr}" duration="${clipDurAttr}" format="${formatId}">`,
      `            <marker start="${startAttr}" duration="${markerDurAttr}" value="${escapeXml(marker.label)}"${noteAttr}/>`,
      '          </asset-clip>',
    );

    const seqAdvance =
      frameDurationAttr(marker.fps) === frameDurationAttr(seqFps)
        ? clipFrames
        : Math.max(1, Math.round((clipFrames / marker.fps.value) * seqFps.value));
    timelineOffsetFrames += seqAdvance;
  }

  const seqDurationAttr = rationalTime(timelineOffsetFrames, seqFps);
  lines.push(
    '  </resources>',
    '  <library>',
    '    <event name="drone-path">',
    '      <project name="drone-path-markers">',
    `        <sequence format="${seqFormatId}" duration="${seqDurationAttr}">`,
    '          <spine>',
    ...spineLines,
    '          </spine>',
    '        </sequence>',
    '      </project>',
    '    </event>',
    '  </library>',
    '</fcpxml>',
    '',
  );

  return lines.join('\n');
}
