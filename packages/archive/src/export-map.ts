import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { LatLon } from 'drone-path-core/geo';

interface MapClip {
  track: LatLon[][];
  gaze: (readonly LatLon[])[];
  label?: string;
  availability?: 'online' | 'offline';
}

export interface MapFlight {
  clips: MapClip[];
}

const require = createRequire(import.meta.url);
// The video renderer has a self-contained module graph and serves tiles through its local cache.
const BASEMAPS = {
  satellite: {
    url: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subdomains: [''],
    attribution:
      '<a href="https://www.esri.com/">Powered by Esri</a> | Imagery &copy; Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 19,
    maxNativeZoom: 17,
  },
};
const tileOrigins = [...new Set(Object.values(BASEMAPS).flatMap(({ url, subdomains }) =>
  subdomains.map((subdomain) => new URL(url.replace('{s}', subdomain)).origin),
))].join(' ');

function leafletAssets() {
  const root = path.dirname(require.resolve('leaflet/package.json'));
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
  const script = read('dist/leaflet.js').replace(/\/\/# sourceMappingURL=.*$/mu, '');
  // This map uses vectors and zoom buttons, so Leaflet's image controls and
  // default marker assets would only introduce unused external references.
  const css = read('dist/leaflet.css').replace(/url\([^)]*\)/gu, 'none');
  return { script, css, license: read('LICENSE') };
}

function basemapClient() {
  return String.raw`
const { satellite, topo } = ${JSON.stringify(BASEMAPS)};
const { url: topoUrl, ...topoOptions } = topo;
const { url: imageryUrl, ...imageryOptions } = satellite;
const imagery = L.layerGroup();
const baseLayers = {
  Topographic: L.tileLayer(topoUrl, topoOptions).addTo(map),
  'Esri imagery': imagery,
  'No basemap': L.layerGroup(),
};
const credentials = document.querySelector('#esri-credentials');
const apiKey = document.querySelector('#esri-key');
const tileError = document.querySelector('#esri-tile-error');
map.on('baselayerchange', ({ layer }) => {
  credentials.hidden = layer !== imagery;
});
credentials.addEventListener('submit', (event) => {
  event.preventDefault();
  const key = apiKey.value.trim();
  if (!key || !map.hasLayer(imagery)) return;
  apiKey.value = '';
  tileError.hidden = true;
  imagery.clearLayers();
  L.tileLayer(imageryUrl + '?token=' + encodeURIComponent(key), imageryOptions)
    .on('tileerror', () => { tileError.hidden = false; })
    .addTo(imagery);
});
`;
}

function mapClient(offline: boolean) {
  // Kept separate from export data: popup text is only assigned to DOM nodes.
  return String.raw`
const flights = JSON.parse(document.querySelector('#archive-data').textContent);
const map = L.map('map');
${offline ? 'const baseLayers = {};' : basemapClient()}
const bounds = L.latLngBounds([]);
const colors = ['#1565c0', '#a33e00', '#00736e', '#a12466', '#613aa1', '#537421'];
const anchor = flights.flatMap((flight) => flight.clips)
  .flatMap((clip) => [...clip.track, ...clip.gaze])[0]?.[0]?.lon ?? 0;
const layers = L.layerGroup().addTo(map);
const footprints = L.layerGroup();
let hasGaze = false;
function coordinates(points) {
  let reference = anchor;
  return points.map(({ lat, lon }) => {
    const wrapped = lon + 360 * Math.round((reference - lon) / 360);
    reference = wrapped;
    return [lat, wrapped];
  });
}
function popup(clip, index) {
  const box = document.createElement('div');
  box.textContent = clip.label ? clip.label + ' (' + clip.availability + ')' : 'Flight ' + (index + 1);
  return box;
}
for (const [index, flight] of flights.entries()) {
  const color = colors[index % colors.length];
  for (const clip of flight.clips) {
    for (const segment of clip.track) {
      const positions = coordinates(segment);
      const layer = positions.length === 1 ? L.circleMarker(positions[0], { color, radius: 4 }) :
        L.polyline(positions, { color, weight: 3, smoothFactor: 0 });
      layer.bindPopup(() => popup(clip, index)).addTo(layers);
      for (const position of positions) bounds.extend(position);
    }
    for (const polygon of clip.gaze) {
      hasGaze = true;
      const positions = coordinates(polygon);
      L.polygon(positions, { color, weight: 1, fillOpacity: 0.1 })
        .bindPopup(() => popup(clip, index)).addTo(footprints);
      for (const position of positions) bounds.extend(position);
    }
  }
}
const overlays = hasGaze ? { 'Camera footprints': footprints.addTo(map) } : {};
if (Object.keys(baseLayers).length || hasGaze) {
  L.control.layers(baseLayers, overlays, { collapsed: false }).addTo(map);
}
if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
else {
  map.setView([0, 0], 2);
  document.querySelector('#empty').hidden = false;
}
`;
}

export function archiveMapHtml(flights: readonly MapFlight[], { offline = false }: { offline?: boolean } = {}): string {
  const { script, css, license } = leafletAssets();
  const data = JSON.stringify(flights).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; img-src ${offline ? "'none'" : tileOrigins}">
<title>Drone Path archive</title>
<style>
${css}
html,body,#map{height:100%;margin:0}
#map{background:#f4f6f7}
#empty{position:absolute;z-index:1000;left:50%;top:1rem;transform:translateX(-50%);padding:.6rem 1rem;background:white;border:1px solid #aeb6bd;font:1rem system-ui,sans-serif}
#esri-credentials{position:absolute;z-index:1000;right:10px;bottom:24px;padding:.6rem;background:white;font:.9rem system-ui,sans-serif}
</style>
</head>
<body>
<div id="map" aria-label="Flight map"></div>
<div id="empty" hidden>No tracks match this export.</div>
${offline ? '' : `<form id="esri-credentials" autocomplete="off" hidden>
<label for="esri-key">ArcGIS API key</label>
<input id="esri-key" type="password" required>
<button type="submit">Load Esri imagery</button>
<p id="esri-tile-error" role="status" hidden>Some Esri tiles could not load. Check your key and connection.</p>
</form>`}
<script type="application/json" id="archive-data">${data}</script>
<!--
${license}
-->
<script>${script}</script>
<script>${mapClient(offline)}</script>
</body>
</html>
`;
}
