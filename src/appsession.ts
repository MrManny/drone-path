// Session vocabulary and state machine for the desktop app, free of Electron
// APIs: pick -> validate -> prepare -> hold one prepared recording.

import fs from 'node:fs';
import path from 'node:path';

import { MEDIA_URL, TILE_BASE } from './apppaths.js';
import { STYLE_VALUES, VIEW_VALUES, asNumber } from './config.js';
import type { LookSettings, RenderConfig, Style, View } from './config.js';
import { errorMessage } from './errors.js';
import type { VideoProbe } from './ff.js';
import type { Bbox } from './geo.js';
import { isRecordingName } from './inputs.js';
import { buildSceneData } from './page.js';
import type { SceneData } from './renderer/scene.js';
import { prepareSession, recordingPageOpts } from './run.js';
import type { LogFn, PipelineDeps, PrepareProgressFn } from './run.js';

export interface PageVideo {
  /** Media URL the <video> element loads, e.g. "app://bundle/media/video". */
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
    },
  };
}

export type PrepareUiSession = (
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
  onProgress: PrepareProgressFn | undefined,
  /** I/O overrides for the pipeline's stages. */
  deps?: Partial<PipelineDeps>,
) => Promise<UiSession>;

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
    scene: buildSceneData(recordingPageOpts(prep, config), TILE_BASE),
    video: {
      src: MEDIA_URL,
      fps: prep.probe.fps.value,
      frames: prep.probe.frames,
      width: prep.probe.width,
      height: prep.probe.height,
    },
    tileBase: TILE_BASE,
    bbox: prep.tel.bbox,
    durationSec: frameExactDuration(prep.probe),
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
  let session: UiSession | null = null;
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
        session = await prepare(resolved, { ...config, ...request.settings }, log, onPrepareProgress);
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
    getSession: () => session,
    videoPath: () => videoPath,
  };
}
