import path from 'node:path';

import { z } from 'zod';

import { TILE_BASE, mediaUrlFor } from '#shared/appurls.js';
import type { RenderConfig } from 'drone-path-engine/config';
import { parseAppearanceSettings } from 'drone-path-engine/config';
import { parseFrameRange } from 'drone-path-core/frame-range';
import type { FrameRange } from 'drone-path-core/frame-range';
import { asRecord, parseValue, strictShape } from 'drone-path-core/validation';
import { classifyError, codedDesktopError } from 'drone-path-desktop/shared/errors';
import type {
  OpenArchiveClipRequest,
  PageVideo,
  PickRequest,
  PickResult,
  TrackSaveRequest,
  UiSession,
} from 'drone-path-desktop/shared/ipc';

export type { OpenArchiveClipRequest, PageVideo, PickRequest, PickResult, TrackSaveRequest, UiSession };
import type { VideoProbe } from 'drone-path-core/ffmpeg';
import { timeAt } from 'drone-path-core/frametime';
import { isRecordingName } from 'drone-path-engine/recordings';
import { buildSceneData } from 'drone-path-engine/render-page';
import {
  prepareSession,
  recordingPageOpts,
  telemetryExportInput,
  trackExportStream,
} from 'drone-path-engine/pipeline';
import type { LogFn } from 'drone-path-engine/logging';
import type { PipelineDeps, PrepareProgressFn } from 'drone-path-engine/pipeline';
import type { TelemetryDocumentInput } from 'drone-path-core/telemetry-json';
import { trackFormatOf } from 'drone-path-core/track-format';
import type { TrackExportInput } from 'drone-path-core/track-write';
import type { TrackStream } from 'drone-path-core/track';

export function frameExactDuration(probe: VideoProbe): number {
  return timeAt(probe.frames, probe.fps.value);
}

export function parsePickRequest(raw: unknown): PickRequest {
  const input = asRecord(raw);
  return { settings: parseAppearanceSettings(input.settings) };
}

const OPEN_ARCHIVE_CLIP_SHAPE = {
  path: z.unknown().optional(),
  settings: z.unknown().optional(),
  seekSec: z.unknown().optional(),
} as z.ZodRawShape;

export function parseOpenArchiveClipRequest(raw: unknown): OpenArchiveClipRequest {
  const input = parseValue(
    strictShape(OPEN_ARCHIVE_CLIP_SHAPE, {
      invalid: 'invalid open archive clip request',
      unknownKey: (key) => `unknown open archive clip request key ${key}`,
    }),
    raw,
  );
  const clipPath = parseValue(
    z
      .string({ error: () => 'invalid open archive clip request: path' })
      .refine((value) => value.trim().length > 0, {
        error: () => 'invalid open archive clip request: path',
      }),
    input.path,
  );
  const settings = parseAppearanceSettings(input.settings);
  const seekSec =
    input.seekSec === undefined
      ? undefined
      : parseValue(
          z.number({ error: () => 'invalid open archive clip request: seekSec' }).finite().min(0),
          input.seekSec,
        );
  return seekSec === undefined
    ? { path: clipPath, settings }
    : { path: clipPath, settings, seekSec };
}

const TRACK_SAVE_SHAPE = {
  outPath: z.unknown().optional(),
  range: z.unknown().optional(),
} as z.ZodRawShape;

export function parseTrackSaveRequest(raw: unknown): TrackSaveRequest {
  const request = parseValue(
    strictShape(TRACK_SAVE_SHAPE, {
      invalid: 'invalid track save request',
      unknownKey: (key) => `unknown track save request key ${key}`,
    }),
    raw,
  );
  const outPath = parseValue(
    z
      .string({ error: () => 'invalid track save request: outPath' })
      .min(1, { error: () => 'invalid track save request: outPath' }),
    request.outPath,
  );
  if (!path.isAbsolute(outPath)) {
    throw codedDesktopError('OUTPUT_PATH_ABSOLUTE', `output path must be absolute: ${outPath}`);
  }
  try {
    trackFormatOf(outPath);
  } catch (e) {
    throw codedDesktopError(
      'INVALID_REQUEST',
      `invalid track save request: outPath must be a .gpx, .geojson, .kml, .kmz or .json file: ${outPath}`,
      undefined,
      e,
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
  track: TrackStream;
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
    track: trackExportStream(prep),
  };
};

export interface SessionIo {
  isFile(filePath: string): boolean;
  writeTrack(file: string, input: TrackExportInput, range: FrameRange | null): void;
}

export interface AppSessionOptions {
  config: RenderConfig;
  pickFile: () => Promise<string | null>;
  io: SessionIo;
  prepare?: PrepareUiSessionFn;
  log?: (msg: string) => void;
  onPreparing?: (videoPath: string) => void;
  onPrepareProgress?: PrepareProgressFn;
}

export interface AppSession {
  pick(request: PickRequest): Promise<PickResult>;
  openFile(filePath: string, request: PickRequest): Promise<PickResult>;
  getSession(): UiSession | null;
  videoPath(): string | null;
  saveTrack(file: string, range: FrameRange | null): void;
}

function isReadableVideo(filePath: string, isFile: (path: string) => boolean): boolean {
  return isRecordingName(filePath) && isFile(filePath);
}

export function createAppSession(options: AppSessionOptions): AppSession {
  const { config, pickFile, io } = options;
  const prepare = options.prepare ?? prepareUiSession;
  const log = options.log ?? ((): void => {});
  const onPreparing = options.onPreparing ?? ((): void => {});
  const onPrepareProgress = options.onPrepareProgress ?? ((): void => {});
  let prepared: PreparedUiSession | null = null;
  let videoPath: string | null = null;
  let picking = false;

  async function loadResolvedVideo(targetPath: string, request: PickRequest): Promise<PickResult> {
    const resolved = path.resolve(targetPath);
    if (!isReadableVideo(resolved, io.isFile)) {
      log(`rejected: ${resolved}`);
      return {
        ok: false,
        code: 'NOT_READABLE_MP4',
        detail: `not a readable .mp4 file: ${resolved}`,
        params: { name: path.basename(resolved) },
      };
    }
    onPreparing(resolved);
    prepared = await prepare(resolved, { ...config, ...request.settings }, log, onPrepareProgress);
    videoPath = resolved;
    log(`loaded: ${resolved}`);
    return { ok: true };
  }

  async function runExclusive(work: () => Promise<PickResult>): Promise<PickResult> {
    if (picking) {
      return { ok: false, code: 'PICK_IN_PROGRESS', detail: 'a pick is already in progress' };
    }
    picking = true;
    try {
      return await work();
    } catch (e) {
      const failure = classifyError(e);
      log(`error: ${failure.detail ?? failure.code}`);
      return { ok: false, ...failure };
    } finally {
      picking = false;
    }
  }

  return {
    pick(request: PickRequest): Promise<PickResult> {
      return runExclusive(async () => {
        const picked = await pickFile();
        if (picked === null) return { ok: false, canceled: true };
        return loadResolvedVideo(picked, request);
      });
    },
    openFile(filePath: string, request: PickRequest): Promise<PickResult> {
      return runExclusive(() => loadResolvedVideo(filePath, request));
    },
    getSession: () => prepared?.session ?? null,
    videoPath: () => videoPath,
    saveTrack(file: string, range: FrameRange | null): void {
      if (!prepared) throw codedDesktopError('NO_RECORDING', 'no recording loaded');
      io.writeTrack(file, { document: prepared.telemetry, track: prepared.track }, range);
    },
  };
}
