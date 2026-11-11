import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { TILE_BASE, mediaUrlFor } from './apppaths.js';
import {
  parseFrameRange,
  parseLookSettings,
  parseValue,
  resolveRange,
  strictShape,
} from './config.js';
import type { FrameRange, LookSettings, RenderConfig } from './config.js';
import { errorMessage } from './errors.js';
import type { VideoProbe } from './ff.js';
import { timeAt } from './frametime.js';
import type { Bbox } from './geo.js';
import { isRecordingName } from './inputs.js';
import { buildSceneData } from './page.js';
import type { SceneData } from './renderer/scene.js';
import {
  prepareSession,
  recordingPageOpts,
  telemetryExportInput,
} from './run.js';
import type { LogFn, PipelineDeps, PrepareProgressFn } from './run.js';
import { writeTelemetryDocument } from './telemetry-json.js';
import type { TelemetryDocumentInput } from './telemetry-json.js';

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
  settings: LookSettings;
}

export function parsePickRequest(raw: unknown): PickRequest {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { settings: parseLookSettings(input.settings) };
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
  if (!outPath.toLowerCase().endsWith('.json')) {
    throw new Error(`invalid telemetry save request: outPath must be a .json file: ${outPath}`);
  }
  const range =
    request.range === undefined || request.range === null
      ? null
      : parseFrameRange(request.range);
  return { outPath, range };
}

export type PrepareUiSession = (
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
  onProgress: PrepareProgressFn | undefined,
  deps?: Partial<PipelineDeps>,
) => Promise<PreparedUiSession>;

export interface PreparedUiSession {
  session: UiSession;
  telemetry: TelemetryDocumentInput;
}

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
  pickFile: () => Promise<string | null>;
  prepare?: PrepareUiSession;
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
      writeTelemetryDocument(file, segmentTelemetryInput(prepared.telemetry, range));
    },
  };
}
