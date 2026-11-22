import { TILE_BASE } from '../../shared/appurls.js';
import { tEnglish } from '../../shared/desktop-i18n/loader.js';
import type { Translate } from '../../shared/desktop-i18n/loader.js';
import { DEFAULT_CONFIG, appearanceOf } from 'drone-path-engine/config';
import type { Bbox } from 'drone-path-core/geo';
import { buildSceneData, planPageOpts } from 'drone-path-engine/render-page';
import { smoothstep } from 'drone-path-engine/renderer/framemath';
import type { SceneData } from 'drone-path-engine/renderer/scene';
import type { RestyleMeta } from 'drone-path-engine/restyle';
import type { FrameChannels } from 'drone-path-core/telemetry-math';

/**
 * The bundled example flight: a fictional, engineered path for the Map
 * appearance preview when no recording is loaded. Pure arithmetic — no
 * randomness, no I/O — so the preview looks identical on every launch and
 * every test run. The shape is chosen so each setting has an obvious visible
 * effect: the trail sweeps across the whole 16:9 frame (trail color, map
 * style), it climbs and descends (the ALT chip reads varying values), it
 * circles a full 360° (the heading arrow turns), and it fills the frame at
 * auto-fit so zoom and frame padding change the framing clearly.
 */

export const EXAMPLE_FPS = 25;
export const EXAMPLE_FRAMES = 3450;
const EXAMPLE_DURATION_SEC = EXAMPLE_FRAMES / EXAMPLE_FPS;
export function exampleStateLabel(t: Translate = tEnglish): string {
  return t('exampleflight.preview');
}
const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 720;

// The flight is designed in meters on a flat plane around a fictional
// mountain-lake launch site; the plane is projected to lat/lon at the end.
const ORIGIN_LAT = 46.62;
const ORIGIN_LON = 14.28;
const METERS_PER_DEG_LAT = 111320;

interface Point {
  x: number;
  y: number;
}

type PathSegment = (u: number) => Point;

function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point): PathSegment {
  return (u) => {
    const v = 1 - u;
    const a = v * v * v;
    const b = 3 * v * v * u;
    const c = 3 * v * u * u;
    const d = u * u * u;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    };
  };
}

function quadraticBezier(p0: Point, p1: Point, p2: Point): PathSegment {
  return (u) => {
    const v = 1 - u;
    return {
      x: v * v * p0.x + 2 * v * u * p1.x + u * u * p2.x,
      y: v * v * p0.y + 2 * v * u * p1.y + u * u * p2.y,
    };
  };
}

function orbit(center: Point, radius: number, startDeg: number): PathSegment {
  const startRad = (startDeg * Math.PI) / 180;
  return (u) => {
    const angle = startRad + u * 2 * Math.PI;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  };
}

// Segment pacing: slow climb, fast ridge run, slow orbit, glide out.
// The per-segment shares are the flight-time budget of 2:18.
const LAUNCH: Point = { x: 62, y: 54 };
const RIDGE_END: Point = { x: 254, y: 161 };
const ORBIT_START: Point = { x: 357, y: 181 };
const ORBIT_CENTER: Point = { x: 384, y: 196 };
const ORBIT_RADIUS = Math.hypot(ORBIT_START.x - ORBIT_CENTER.x, ORBIT_START.y - ORBIT_CENTER.y);
const ORBIT_START_DEG =
  (Math.atan2(ORBIT_START.y - ORBIT_CENTER.y, ORBIT_START.x - ORBIT_CENTER.x) * 180) / Math.PI;
const LANDING: Point = { x: 160, y: 70 };

// Segment lengths are frames to the next shared boundary point; together with
// the launch point they cover every frame exactly once.
const SEGMENTS: ReadonlyArray<{ path: PathSegment; frames: number }> = [
  {
    path: cubicBezier(LAUNCH, { x: 124, y: 146 }, { x: 187, y: 85 }, RIDGE_END),
    frames: 1213,
  },
  {
    path: quadraticBezier(RIDGE_END, { x: 304, y: 251 }, ORBIT_START),
    frames: 388,
  },
  {
    path: orbit(ORBIT_CENTER, ORBIT_RADIUS, ORBIT_START_DEG),
    frames: 838,
  },
  {
    path: cubicBezier(ORBIT_START, { x: 386, y: 134 }, { x: 255, y: 55 }, LANDING),
    frames: 1010,
  },
];

const ALTITUDE_KEYS: ReadonlyArray<{ frame: number; meters: number }> = [
  { frame: 0, meters: 20 },
  { frame: 1213, meters: 95 },
  { frame: 1601, meters: 118 },
  { frame: 2439, meters: 116 },
  { frame: EXAMPLE_FRAMES - 1, meters: 25 },
];

function samplePath(): Point[] {
  const points: Point[] = [SEGMENTS[0].path(0)];
  for (const { path, frames } of SEGMENTS) {
    for (let i = 1; i <= frames; i++) points.push(path(i / frames));
  }
  return points;
}

function altitudeAt(frame: number): number {
  const keys = ALTITUDE_KEYS;
  for (let k = 0; k + 1 < keys.length; k++) {
    const lo = keys[k];
    const hi = keys[k + 1];
    if (frame >= lo.frame && frame <= hi.frame) {
      const t = (frame - lo.frame) / (hi.frame - lo.frame);
      return lo.meters + (hi.meters - lo.meters) * smoothstep(t);
    }
  }
  return keys[keys.length - 1].meters;
}

function movingAverage(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      sum += values[j];
      count += 1;
    }
    return sum / count;
  });
}

function buildChannels(points: Point[]): FrameChannels {
  const dt = 1 / EXAMPLE_FPS;
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);
  const lat = points.map((p) => ORIGIN_LAT + p.y / METERS_PER_DEG_LAT);
  const lon = points.map((p) => ORIGIN_LON + p.x / metersPerDegLon);

  const speed: number[] = points.map((p, i) => {
    const next = points[Math.min(points.length - 1, i + 1)];
    return Math.hypot(next.x - p.x, next.y - p.y) / dt;
  });
  const smoothSpeed = movingAverage(speed, 8);

  const headingDeg: number[] = points.map((_, i) => {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    return (Math.atan2(after.x - before.x, after.y - before.y) * 180) / Math.PI;
  });
  const heading = headingDeg.map((deg) => (deg + 360) % 360);

  const alt = points.map(
    (_, i) => altitudeAt(i) + 2.5 * Math.sin((2 * Math.PI * i) / 337),
  );

  return {
    lat,
    lon,
    alt: alt.map((meters) => Math.round(meters * 10) / 10),
    speed: smoothSpeed.map((v) => Math.round(v * 100) / 100),
    headingDeg: heading,
  };
}

function pathBbox(lat: readonly number[], lon: readonly number[]): Bbox {
  const minLat = Math.min(...lat);
  const maxLat = Math.max(...lat);
  const minLon = Math.min(...lon);
  const maxLon = Math.max(...lon);
  // A little air around the trail keeps it off the frame edges at auto-fit.
  const padLat = (maxLat - minLat) * 0.08;
  const padLon = (maxLon - minLon) * 0.08;
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLon: minLon - padLon,
    maxLon: maxLon + padLon,
  };
}

export interface ExampleFlight {
  channels: FrameChannels;
  bbox: Bbox;
  fps: number;
  frames: number;
  durationSec: number;
  /** The scene planned at the preview size with default appearance. */
  baseScene: SceneData;
  meta: RestyleMeta;
}

function buildExampleFlight(): ExampleFlight {
  const points = samplePath();
  const channels = buildChannels(points);
  const bbox = pathBbox(channels.lat, channels.lon);
  const planned = planPageOpts({
    bbox,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    config: appearanceOf(DEFAULT_CONFIG),
    source: { fps: EXAMPLE_FPS, frames: EXAMPLE_FRAMES },
    frames: channels,
  });
  return {
    channels,
    bbox,
    fps: EXAMPLE_FPS,
    frames: EXAMPLE_FRAMES,
    durationSec: EXAMPLE_DURATION_SEC,
    baseScene: buildSceneData(planned, TILE_BASE),
    meta: {
      fps: EXAMPLE_FPS,
      frames: EXAMPLE_FRAMES,
      tileBase: TILE_BASE,
      bbox,
    },
  };
}

let cachedExampleFlight: ExampleFlight | null = null;

export function getExampleFlight(): ExampleFlight {
  cachedExampleFlight ??= buildExampleFlight();
  return cachedExampleFlight;
}
