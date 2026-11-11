import { hasAltitude, resolveHudSpec } from './config.js';
import type { HudSpec, LookSettings, Style, View } from './config.js';
import { decimateTrack } from './decimate.js';
import type { DecimatedTrack } from './decimate.js';
import { unproject } from './geo.js';
import type { Bbox, LatLon } from './geo.js';
import { planIntroOutroFrames, planView } from './plan.js';
import type { IntroOutroFrames, Overview } from './plan.js';
import type { SceneData } from './renderer/scene.js';
import { TILE_SOURCES } from './renderer/tilesources.js';
import type { FrameChannels } from './telemetry-math.js';

export interface PageOpts extends FrameChannels {
  width: number;
  height: number;
  style: Style;
  trailColor: string | null;
  view: View;
  center: LatLon;
  zoom: number;
  attribution: string;
  hud: HudSpec;
  decimated: DecimatedTrack;
  introN?: number;
  outroN?: number;
}

export function planPageOpts(opts: {
  bbox: Bbox;
  width: number;
  height: number;
  config: LookSettings;
  source: { fps: number; frames: number };
  frames: FrameChannels;
  planned?: { overview: Overview; introOutro: IntroOutroFrames; hud: HudSpec };
  previous?: { zoom: number; decimated: DecimatedTrack };
}): PageOpts {
  const { bbox, width, height, config, source, frames, planned, previous } = opts;
  const overview = planned?.overview ?? planView(bbox, width, height, config);
  const introOutro = planned?.introOutro ?? planIntroOutroFrames(config, source);
  const hud = planned?.hud ?? resolveHudSpec(config.hud, hasAltitude(frames.alt));
  const decimated =
    previous && previous.zoom === overview.zoom
      ? previous.decimated
      : decimateTrack(frames.lat, frames.lon, overview.zoom);
  return {
    width,
    height,
    style: config.style,
    trailColor: config.trailColor,
    view: config.view,
    center: unproject(overview.centerPx.x, overview.centerPx.y, overview.zoom),
    zoom: overview.zoom,
    attribution: TILE_SOURCES[config.style].attribution,
    introN: introOutro.introN,
    outroN: introOutro.outroN,
    lat: frames.lat,
    lon: frames.lon,
    alt: frames.alt,
    speed: frames.speed,
    headingDeg: frames.headingDeg,
    hud,
    decimated,
  };
}

export function buildSceneData(opts: PageOpts, tileBase: string): SceneData {  const {
    width, height, style, trailColor, view, center, zoom, attribution,
    lat, lon, alt, speed, headingDeg, hud, decimated,
    introN = 0, outroN = 0,
  } = opts;
  return {
    style,
    trailColor,
    tileUrl: tileBase + '/' + style + '/{z}/{x}/{y}.png',
    view,
    width,
    height,
    zoom,
    center: { lat: center.lat, lon: center.lon },
    attribution,
    introN,
    outroN,
    lat, lon, alt, speed, headingDeg,
    hud,
    trailLat: decimated.lat,
    trailLon: decimated.lon,
    trailFrame: decimated.frame,
  };
}

function bootScript(dataJson: string): string {
  return `import { bootScene } from '/renderer/boot.js';
var D = window.__DATA = ${dataJson};
var scene = bootScene(document.getElementById('scene-host'), D, window.L);
window.__setFrame = function (i) { return scene.setFrame(i); };
window.__relayout = function () { scene.relayout(); };
scene.ready.then(function () { window.__READY = true; });`;
}

export function buildPageHtml(opts: PageOpts): string {
  const data = buildSceneData(opts, '/tiles');
  // "</" must not appear verbatim: the JSON is inlined into a <script> tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>flight map</title>
<link rel="stylesheet" href="/leaflet/leaflet.css">
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${TILE_SOURCES[opts.style].bg}; }
</style>
</head>
<body>
<div id="scene-host"></div>
<script src="/leaflet/leaflet.js"></script>
<script type="module">
${bootScript(json)}
</script>
</body>
</html>`;
}
