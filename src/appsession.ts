// Session vocabulary and state machine for the desktop app, free of Electron
// APIs: pick -> validate -> prepare -> hold one prepared recording.

import fs from 'node:fs';
import path from 'node:path';

import { MEDIA_URL, TILE_BASE } from './apppaths.js';
import { STYLE_VALUES, VIEW_VALUES, asNumber } from './config.js';
import type { RenderConfig, SettingsPatch, Style, View } from './config.js';
import { errorMessage } from './errors.js';
import type { VideoProbe } from './ff.js';
import type { Bbox } from './geo.js';
import { isRecordingName } from './inputs.js';
import { buildSceneData } from './page.js';
import { displayedTiles, planView } from './plan.js';
import type { TileCoord } from './plan.js';
import type { SceneData } from './renderer/scene.js';
import { prepareSession, recordingPageOpts } from './run.js';
import type { LogFn, PrepareProgressFn } from './run.js';
import { prefetchTiles } from './tiles.js';

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

/** What the map shows: the look settings and the frame they fill. */
export interface WarmRequest {
  settings: SettingsPatch;
  /** The frame the map fills in px (the app's map pane). */
  frame: { width: number; height: number };
}

// The IPC boundary's vocabulary check: whatever the renderer sends, the
// gate and the warm stream only ever plan from a valid look.
export function parseWarmRequest(raw: unknown): WarmRequest {
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
  const frame =
    typeof input.frame === 'object' && input.frame !== null
      ? (input.frame as Record<string, unknown>)
      : {};
  const width = asNumber(frame.width, 'frame width');
  const height = asNumber(frame.height, 'frame height');
  if (!(width > 0) || !(height > 0)) throw new Error('frame size must be positive');
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
    frame: { width, height },
  };
}

/** The running pre-warm count over the current plan; 0 means nothing streams. */
export interface WarmProgress {
  done: number;
  total: number;
}

export interface WarmHandle {
  /**
   * Pivot the background pre-warm onto the tiles these settings and this
   * frame display: downloads still queued for the previous plan are dropped
   * and the running count restarts against the new plan, whose cached tiles
   * count at once. Repeating the plan already streaming changes nothing.
   */
  retarget(request: WarmRequest): void;
  /** Drop the background pre-warm: the player is taking over the tile needs. */
  cancel(): void;
}

export type PrepareUiSession = (
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
  onProgress: PrepareProgressFn | undefined,
  frame: { width: number; height: number },
) => Promise<UiSession>;

// The shared pipeline preparation plus the scene data the UI drives. The app
// opens at the gate switch: the preparation waits for the tiles the first
// frame shows and the warm stream covers what the map displays behind the
// player.
export const prepareUiSession: PrepareUiSession = async (
  videoPath,
  config,
  log,
  onProgress,
  frame,
) => {
  const prep = await prepareSession(videoPath, config, log, {
    onProgress,
    tileWait: 'gate',
    frameSize: frame,
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
  /** Streams one plan's tiles into the cache behind the player. */
  streamTiles?: typeof prefetchTiles;
  /** Running count of the background pre-warm, for the player's hint. */
  onWarmProgress?: (progress: WarmProgress) => void;
}

export interface AppSession {
  pick(request: WarmRequest): Promise<PickResult>;
  getSession(): UiSession | null;
  videoPath(): string | null;
  /** The background tile pre-warm of the loaded recording. */
  warm: WarmHandle;
}

function isReadableVideo(filePath: string): boolean {
  if (!isRecordingName(filePath)) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

interface WarmRun {
  key: string;
  controller: AbortController;
  settled: number;
  total: number;
}

// The background pre-warm behind the gate switch: it streams the tiles the
// map displays, reports the running count and pivots onto a new plan when the
// look or the frame re-plans the map. Settles arrive in bursts (cached tiles
// count at once), so one microtask turn emits at most one count: the hint
// ticks instead of strobing, and a plan that is already warm never flashes a
// hint at all.
function createWarmStream(options: {
  cacheDir: string;
  log: LogFn;
  streamTiles: typeof prefetchTiles;
  onProgress: (progress: WarmProgress) => void;
  plan: (request: WarmRequest) => TileCoord[];
}): WarmHandle {
  const { cacheDir, log, streamTiles, onProgress, plan } = options;
  let run: WarmRun | null = null;
  let emitScheduled = false;

  const scheduleEmit = (): void => {
    if (emitScheduled) return;
    emitScheduled = true;
    queueMicrotask(() => {
      emitScheduled = false;
      onProgress(run ? { done: run.settled, total: run.total } : { done: 0, total: 0 });
    });
  };

  const stop = (): void => {
    if (!run) return;
    run.controller.abort();
    run = null;
    scheduleEmit();
  };

  return {
    retarget(request) {
      const tiles = plan(request);
      const key = `${request.settings.style}:${tiles.map((t) => `${t.z}/${t.x}/${t.y}`).join(',')}`;
      if (run?.key === key) return;
      stop();
      const started: WarmRun = {
        key,
        controller: new AbortController(),
        settled: 0,
        total: tiles.length,
      };
      run = started;
      scheduleEmit();
      void streamTiles({
        style: request.settings.style,
        tiles,
        cacheDir,
        log,
        signal: started.controller.signal,
        onTile: () => {
          if (run !== started) return;
          started.settled++;
          scheduleEmit();
        },
      }).catch((e: unknown) => {
        // A superseded run's rejection is its cancellation; a live run that
        // died leaves an unwarmable cache behind, so the hint clears and the
        // remaining tiles stay on-demand work.
        if (run !== started) return;
        log(`tiles: ${errorMessage(e)}`);
        run = null;
        scheduleEmit();
      });
    },
    cancel: stop,
  };
}

export function createAppSession(options: AppSessionOptions): AppSession {
  const { config, pickFile } = options;
  const prepare = options.prepare ?? prepareUiSession;
  const log = options.log ?? ((): void => {});
  const onPreparing = options.onPreparing ?? ((): void => {});
  const onPrepareProgress = options.onPrepareProgress ?? ((): void => {});
  const streamTiles = options.streamTiles ?? prefetchTiles;
  const onWarmProgress = options.onWarmProgress ?? ((): void => {});
  let session: UiSession | null = null;
  let videoPath: string | null = null;
  let picking = false;

  // The warm stream follows the tiles the map displays; the bbox, the scene
  // zoom and the frame are the very planning inputs the renderer's layout
  // uses, so the hint's counts always describe the tiles on screen.
  const warm = createWarmStream({
    cacheDir: config.tileCache,
    log,
    streamTiles,
    onProgress: onWarmProgress,
    plan: (request) => {
      if (!session) return [];
      const { bbox } = session;
      const { width, height } = session.scene;
      const zoom = planView(bbox, width, height, request.settings).zoom;
      return displayedTiles(bbox, zoom, request.frame, request.settings);
    },
  });

  return {
    async pick(request: WarmRequest): Promise<PickResult> {
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
        warm.cancel();
        onPreparing(resolved);
        // The renderer's current look prepares the recording: what the player
        // shows and what the gate warms must be the same plan.
        session = await prepare(
          resolved,
          { ...config, ...request.settings },
          log,
          onPrepareProgress,
          request.frame,
        );
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
    warm,
  };
}
