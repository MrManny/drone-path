import type { RenderConfig } from './config.js';
import { project } from './geo.js';
import type { Bbox, MercatorPixel } from './geo.js';
import { TILE_SOURCES } from './renderer/tilesources.js';

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface OverviewPlanOptions {
  bbox: Bbox;
  width: number;
  height: number;
  maxZoom?: number;
  zoomOut?: number;
  follow?: boolean;
  maxNativeZoom?: number | null;
  zoomOverride?: number;
}

export interface OverviewPlan {
  centerPx: MercatorPixel;
  zoom: number;
  tiles: TileCoord[];
}

const MIN_ZOOM = 2;
const HOVER_ZOOM_FLOOR = 16;
const MIN_TRACK_SPAN_PX = 80;
const TILE_SIZE_PX = 256;

function fitZoomToTrack(
  bbox: Bbox,
  availW: number,
  availH: number,
  maxZoom: number,
): number {
  for (let zoom = maxZoom; zoom >= MIN_ZOOM; zoom--) {
    const northWest = project(bbox.minLon, bbox.maxLat, zoom);
    const southEast = project(bbox.maxLon, bbox.minLat, zoom);
    const fits =
      southEast.x - northWest.x <= availW &&
      southEast.y - northWest.y <= availH;
    if (fits) return zoom;
  }
  return MIN_ZOOM;
}

function pullBackTinyTracks(zoom: number, bbox: Bbox): number {
  while (zoom > HOVER_ZOOM_FLOOR) {
    const northWest = project(bbox.minLon, bbox.maxLat, zoom);
    const southEast = project(bbox.maxLon, bbox.minLat, zoom);
    const spansEnough =
      southEast.x - northWest.x >= MIN_TRACK_SPAN_PX ||
      southEast.y - northWest.y >= MIN_TRACK_SPAN_PX;
    if (spansEnough) break;
    zoom--;
  }
  return zoom;
}

function tilesCovering(
  centerPx: MercatorPixel,
  trackSpanPx: MercatorPixel,
  zoom: number,
  width: number,
  height: number,
  follow: boolean,
  maxNativeZoom: number | null,
): TileCoord[] {
  const tileZoom = maxNativeZoom
    ? Math.min(zoom, maxNativeZoom)
    : zoom;
  const scale = 2 ** (tileZoom - zoom);
  const halfW = (width + TILE_SIZE_PX + (follow ? trackSpanPx.x / 2 : 0)) * scale;
  const halfH = (height + TILE_SIZE_PX + (follow ? trackSpanPx.y / 2 : 0)) * scale;

  const maxTileIndex = 2 ** tileZoom - 1;
  const xMin = Math.max(0, Math.floor((centerPx.x * scale - halfW) / TILE_SIZE_PX));
  const xMax = Math.min(maxTileIndex, Math.floor((centerPx.x * scale + halfW) / TILE_SIZE_PX));
  const yMin = Math.max(0, Math.floor((centerPx.y * scale - halfH) / TILE_SIZE_PX));
  const yMax = Math.min(maxTileIndex, Math.floor((centerPx.y * scale + halfH) / TILE_SIZE_PX));

  const tiles: TileCoord[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) tiles.push({ z: tileZoom, x, y });
  }
  return tiles;
}

export function computeOverview({
  bbox,
  width,
  height,
  maxZoom = 19,
  zoomOut = 0,
  follow = false,
  maxNativeZoom = null,
  zoomOverride = 0,
}: OverviewPlanOptions): OverviewPlan {
  const padX = Math.round(width * 0.08);
  const padY = Math.round(height * 0.08);
  const availW = Math.max(64, width - 2 * padX);
  const availH = Math.max(64, height - 2 * padY);

  let zoom: number;
  if (zoomOverride > 0) {
    zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.round(zoomOverride)));
  } else {
    zoom = pullBackTinyTracks(
      fitZoomToTrack(bbox, availW, availH, maxZoom),
      bbox,
    );
    zoom = Math.max(MIN_ZOOM, zoom - Math.max(0, Math.floor(zoomOut)));
  }

  const northWest = project(bbox.minLon, bbox.maxLat, zoom);
  const southEast = project(bbox.maxLon, bbox.minLat, zoom);
  const centerPx: MercatorPixel = {
    x: (northWest.x + southEast.x) / 2,
    y: (northWest.y + southEast.y) / 2,
  };
  const trackSpanPx: MercatorPixel = {
    x: southEast.x - northWest.x,
    y: southEast.y - northWest.y,
  };

  return {
    centerPx,
    zoom,
    tiles: tilesCovering(
      centerPx, trackSpanPx, zoom, width, height, follow, maxNativeZoom,
    ),
  };
}

export interface IntroOutroFrames {
  introN: number;
  outroN: number;
  clamped: boolean;
}

export function planView(
  bbox: Bbox,
  width: number,
  height: number,
  config: Pick<RenderConfig, 'style' | 'view' | 'zoom' | 'zoomOut'>,
): OverviewPlan {
  const src = TILE_SOURCES[config.style];
  return computeOverview({
    bbox,
    width,
    height,
    maxZoom: src.maxZoom || 19,
    maxNativeZoom: src.maxNativeZoom ?? null,
    zoomOut: config.zoomOut,
    zoomOverride: config.zoom,
    follow: config.view === 'follow',
  });
}

export function planIntroOutroFrames(
  config: Pick<RenderConfig, 'introSec' | 'outroSec'>,
  source: { fps: number; frames: number },
): IntroOutroFrames {
  let introN = Math.max(0, Math.round(config.introSec * source.fps));
  let outroN = Math.max(0, Math.round(config.outroSec * source.fps));
  const budget = Math.max(2, Math.floor(source.frames / 2));
  const clamped = introN + outroN > budget;
  if (clamped) {
    const scale = budget / (introN + outroN);
    introN = Math.floor(introN * scale);
    outroN = Math.floor(outroN * scale);
  }
  return { introN, outroN, clamped };
}
