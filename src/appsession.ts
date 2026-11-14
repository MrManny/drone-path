import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { TILE_BASE, mediaUrlFor } from './apppaths.js';
import {
  parseFrameRange,
  parseAppearanceSettings,
  parseValue,
  strictShape,
} from './config.js';
import type { FrameRange, AppearanceSettings, RenderConfig } from './config.js';
import { ERR_NO_RECORDING, ERR_NOT_READABLE_MP4, errorMessage } from './errors.js';
import type { VideoProbe } from './ffmpeg.js';
import { timeAt } from './frametime.js';
import type { Bbox } from './geo.js';
import { isRecordingName } from './recordings.js';
import { buildSceneData } from './render-page.js';
import type { SceneData } from './renderer/scene.js';
import {
  prepareSession,
  recordingPageOpts,
  telemetryExportInput,
  trackExportInput,
} from './pipeline.js';
import type { LogFn } from './logging.js';
import type { PipelineDeps, PrepareProgressFn } from './pipeline.js';
import { segmentTelemetryInput } from './telemetry-json.js';
import type { TelemetryDocumentInput } from './telemetry-json.js';
import { trackFormatOf } from './track-format.js';
import { writeTrackFile } from './track-write.js';

export interface PageVideo {
  src: string;
  fps: number;
  frames: number;
  width: number;
  height: number;
}

export function frameExactDuration(probe: VideoProbe): number {
  return timeAt(probe.frames, probe.fps.value);
}

export interface UiSession {
  scene: SceneData;
  video: PageVideo;
  tileBase: string;
  bbox: Bbox;
  durationSec: number;
}

export interface IpcResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
}

export type PickResult = IpcResult;

export interface PickRequest {
  settings: AppearanceSettings;
}

export function parsePickRequest(raw: unknown): PickRequest {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { settings: parseAppearanceSettings(input.settings) };
}

export interface TelemetrySaveRequest {
  outPath: string;
  range: FrameRange | null;
}

const TELEMETRY_SAVE_SHAPE = {
  outPath: z.unknown().optional(),
  range: z.unknown().optional(),
} as z.ZodRawShape;

export function parseTelemetrySaveRequest(raw: unknown): TelemetrySaveRequest {
  const request = parseValue(
    strictShape(TELEMETRY_SAVE_SHAPE, {
      invalid: 'invalid telemetry save request',
      unknownKey: (key) => `unknown telemetry save request key ${key}`,
    }),
    raw,
  );
  const outPath = parseValue(
    z
      .string({ error: () => 'invalid telemetry save request: outPath' })
      .min(1, { error: () => 'invalid telemetry save request: outPath' }),
    request.outPath,
  );
  try {
    trackFormatOf(outPath);
  } catch (e) {
    throw new Error(
      `invalid telemetry save request: outPath must be a .gpx, .geojson, .kml, .kmz or .json file: ${outPath}`,
      { cause: e },
    );
  }
  const range =
    request.range === undefined || request.range === null
      ? null
      : parseFrameRange(request.range);
  return { outPath, range };
}

export type PrepareUiSessionFn = (
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
  onProgress: PrepareProgressFn | undefined,
  deps?: Partial<PipelineDeps>,
) => Promise<PreparedUiSession>;

export interface PreparedUiSession {
  session: UiSession;
  telemetry: TelemetryDocumentInput;
  // Fix-faithful records for the track formats; main-side only, never sent
  // over IPC. The .json document keeps reading `telemetry`.
  track: TelemetryDocumentInput;
}

export const prepareUiSession: PrepareUiSessionFn = async (
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
    track: trackExportInput(prep),
  };
};

export interface AppSessionOptions {
  config: RenderConfig;
  pickFile: () => Promise<string | null>;
  prepare?: PrepareUiSessionFn;
  log?: (msg: string) => void;
  onPreparing?: (videoPath: string) => void;
  onPrepareProgress?: PrepareProgressFn;
}

export interface AppSession {
  pick(request: PickRequest): Promise<PickResult>;
  getSession(): UiSession | null;
  videoPath(): string | null;
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
          return { ok: false, error: `${ERR_NOT_READABLE_MP4}${resolved}` };
        }
        onPreparing(resolved);
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
      if (!prepared) throw new Error(ERR_NO_RECORDING);
      const input =
        trackFormatOf(file) === 'json' ? prepared.telemetry : prepared.track;
      writeTrackFile(file, segmentTelemetryInput(input, range));
    },
  };
}
