import fs from 'node:fs';
import path from 'node:path';

import { TILE_BASE, mediaUrlFor } from './apppaths.js';
import {
  STYLE_VALUES,
  VIEW_VALUES,
  asNumber,
  asTrailColor,
  parseFrameRange,
} from './config.js';
import type { FrameRange, LookSettings, RenderConfig, Style, View } from './config.js';
import { errorMessage } from './errors.js';
import type { VideoProbe } from './ff.js';
import type { Bbox } from './geo.js';
import { isRecordingName } from './inputs.js';
import { buildSceneData } from './page.js';
import type { SceneData } from './renderer/scene.js';
import {
  prepareSession,
  recordingPageOpts,
  resolveRange,
  telemetryExportInput,
} from './run.js';
import type { LogFn, PipelineDeps, PrepareProgressFn } from './run.js';
import { buildTelemetryDocument, serializeTelemetryDocument } from './telemetry-json.js';
import type { TelemetryDocumentInput } from './telemetry-json.js';

export interface PageVideo {
  /** Media URL the <video> element loads, e.g. "app://bundle/media/video?v=…". */
  src: string;
  /** Frames per second as a number; seeks snap to i / fps. */
  fps: number;
  frames: number;
  /** Source dimensions; the picture-in-picture box matches this aspect. */
  width: number;
  height: number;
}

/** Frame-exact duration from the reported frames and rate, not the container's. */
export function frameExactDuration(probe: VideoProbe): number {
  return probe.frames / probe.fps.value;
}

export interface UiSession {
  scene: SceneData;
  video: PageVideo;
  /** Where tiles are served from; restyle rebuilds scene.tileUrl from it. */
  tileBase: string;
  /** The telemetry's fix bbox: restyle plans the view from it, like the pipeline. */
  bbox: Bbox;
  /** The one duration definition the time readout and the export form share. */
  durationSec: number;
}

export interface PickResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
}

/** What the Open flow sends: the look the player currently shows. */
export interface PickRequest {
  settings: LookSettings;
}

// The IPC boundary's vocabulary check: whatever the renderer sends, the
// preparation only ever plans from a valid look.
export function parsePickRequest(raw: unknown): PickRequest {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const look =
    typeof input.settings === 'object' && input.settings !== null
      ? (input.settings as Record<string, unknown>)
      : {};
  const { style, view, hud } = look;
  if (typeof style !== 'string' || !STYLE_VALUES.includes(style as Style)) {
    throw new Error(`unknown map style: ${String(style)}`);
  }
  if (typeof view !== 'string' || !VIEW_VALUES.includes(view as View)) {
    throw new Error(`unknown view: ${String(view)}`);
  }
  const zoom = asNumber(look.zoom, 'zoom');
  const zoomOut = asNumber(look.zoomOut, 'zoom-out');
  if (!(zoom >= 0)) throw new Error('zoom must be >= 0 (0 = auto-fit)');
  if (!(zoomOut >= 0)) throw new Error('zoom-out must be >= 0');
  const introSec = asNumber(look.introSec, 'intro');
  const outroSec = asNumber(look.outroSec, 'outro');
  if (!(introSec >= 0)) throw new Error('intro must be 0 or more');
  if (!(outroSec >= 0)) throw new Error('outro must be 0 or more');
  const trailColor = asTrailColor(look.trailColor ?? null, 'trail color');
  const chips = typeof hud === 'object' && hud !== null ? (hud as Record<string, unknown>) : {};
  return {
    settings: {
      style: style as Style,
      view: view as View,
      zoom,
      zoomOut,
      hud: { heading: !!chips.heading, alt: !!chips.alt, speed: !!chips.speed },
      introSec,
      outroSec,
      trailColor,
    },
  };
}

/** What the Save telemetry JSON flow sends: the chosen file and the scope. */
export interface TelemetrySaveRequest {
  /** Destination path; the native save dialog fixes the .json extension. */
  outPath: string;
  /** Source-frame segment to save, or null for the full recording. */
  range: FrameRange | null;
}

// The IPC boundary's vocabulary check: whatever the renderer sends, the save
// only ever writes one file for one valid frame range.
export function parseTelemetrySaveRequest(raw: unknown): TelemetrySaveRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('invalid telemetry save request');
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (key !== 'outPath' && key !== 'range') {
      throw new Error(`unknown telemetry save request key ${key}`);
    }
  }
  if (typeof r.outPath !== 'string' || !r.outPath) {
    throw new Error('invalid telemetry save request: outPath');
  }
  // Like parseExportRequest's container check: the .json suffix fixes the
  // document format whatever the renderer typed.
  if (!r.outPath.toLowerCase().endsWith('.json')) {
    throw new Error(`invalid telemetry save request: outPath must be a .json file: ${r.outPath}`);
  }
  const range =
    r.range === undefined || r.range === null ? null : parseFrameRange(r.range);
  return { outPath: r.outPath, range };
}

export type PrepareUiSession = (
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
  onProgress: PrepareProgressFn | undefined,
  /** I/O overrides for the pipeline's stages. */
  deps?: Partial<PipelineDeps>,
) => Promise<PreparedUiSession>;

/** What a preparation yields: the player's session plus the telemetry JSON
 * document input the workspace's save action writes from. */
export interface PreparedUiSession {
  session: UiSession;
  telemetry: TelemetryDocumentInput;
}

// The shared pipeline preparation plus the scene data the UI drives: probe,
// telemetry and the view plan — no tile wait, so the footage shows right away
// and the map fetches its tiles on demand.
export const prepareUiSession: PrepareUiSession = async (
  videoPath,
  config,
  log,
  onProgress,
  deps,
) => {
  const prep = await prepareSession(videoPath, config, log, {
    onProgress,
    deps,
  });
  return {
    session: {
      scene: buildSceneData(recordingPageOpts(prep, config), TILE_BASE),
      video: {
        src: mediaUrlFor(videoPath),
        fps: prep.probe.fps.value,
        frames: prep.probe.frames,
        width: prep.probe.width,
        height: prep.probe.height,
      },
      tileBase: TILE_BASE,
      bbox: prep.tel.bbox,
      durationSec: frameExactDuration(prep.probe),
    },
    telemetry: telemetryExportInput(prep),
  };
};

export interface AppSessionOptions {
  config: RenderConfig;
  /** Opens the native file dialog; resolves null when the user cancels. */
  pickFile: () => Promise<string | null>;
  prepare?: PrepareUiSession;
  log?: (msg: string) => void;
  /** Fires once a picked file passes the checks, right before preparation starts. */
  onPreparing?: (videoPath: string) => void;
  /** Loading progress of the preparation, for progress displays. */
  onPrepareProgress?: PrepareProgressFn;
}

export interface AppSession {
  pick(request: PickRequest): Promise<PickResult>;
  getSession(): UiSession | null;
  videoPath(): string | null;
  /** Writes the telemetry JSON document for the full recording or one
   * source-frame segment; throws when no recording is loaded or the range
   * falls outside it. */
  saveTelemetryJson(file: string, range: FrameRange | null): void;
}

function isReadableVideo(filePath: string): boolean {
  if (!isRecordingName(filePath)) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// The segment save's input: rows and headings sliced onto the requested
// source-frame range, with frameStart keeping the record numbers on the
// recording's own frame indices. The range guard is the pipeline's own
// resolveRange, so the save and the segment render agree by construction.
function segmentTelemetryInput(
  input: TelemetryDocumentInput,
  range: FrameRange | null,
): TelemetryDocumentInput {
  const segment = resolveRange(range, input.frameCount);
  if (!segment) return input;
  return {
    ...input,
    frameCount: segment.end - segment.start + 1,
    frames: input.frames.slice(segment.start, segment.end + 1),
    headingDeg: input.headingDeg.slice(segment.start, segment.end + 1),
    frameStart: segment.start,
  };
}

export function createAppSession(options: AppSessionOptions): AppSession {
  const { config, pickFile } = options;
  const prepare = options.prepare ?? prepareUiSession;
  const log = options.log ?? ((): void => {});
  const onPreparing = options.onPreparing ?? ((): void => {});
  const onPrepareProgress = options.onPrepareProgress ?? ((): void => {});
  let prepared: PreparedUiSession | null = null;
  let videoPath: string | null = null;
  let picking = false;

  return {
    async pick(request: PickRequest): Promise<PickResult> {
      if (picking) return { ok: false, error: 'a pick is already in progress' };
      picking = true;
      try {
        const picked = await pickFile();
        if (picked === null) return { ok: false, canceled: true };
        const resolved = path.resolve(picked);
        if (!isReadableVideo(resolved)) {
          log(`rejected: ${resolved}`);
          return { ok: false, error: `not a readable .mp4 file: ${resolved}` };
        }
        onPreparing(resolved);
        // The renderer's current look prepares the recording, so the prepared
        // scene matches what the player shows.
        prepared = await prepare(resolved, { ...config, ...request.settings }, log, onPrepareProgress);
        videoPath = resolved;
        log(`loaded: ${resolved}`);
        return { ok: true };
      } catch (e) {
        log(`error: ${errorMessage(e)}`);
        return { ok: false, error: errorMessage(e) };
      } finally {
        picking = false;
      }
    },
    getSession: () => prepared?.session ?? null,
    videoPath: () => videoPath,
    saveTelemetryJson(file: string, range: FrameRange | null): void {
      if (!prepared) throw new Error('no recording loaded');
      const doc = buildTelemetryDocument(segmentTelemetryInput(prepared.telemetry, range));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, serializeTelemetryDocument(doc));
    },
  };
}
