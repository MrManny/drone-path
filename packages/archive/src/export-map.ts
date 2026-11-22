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
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subdomains: [''],
    attribution:
      'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
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

function mapClient() {
  // Kept separate from export data: popup text is only assigned to DOM nodes.
  return String.raw`
const flights = JSON.parse(document.querySelector('#archive-data').textContent);
const map = L.map('map');
const sources = ${JSON.stringify(BASEMAPS)};
function basemap({ url, ...options }) {
  return L.tileLayer(url, options);
}
const baseLayers = {
  'Esri imagery': basemap(sources.satellite).addTo(map),
  'Topographic': basemap(sources.topo),
  'No basemap': L.layerGroup(),
};
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
L.control.layers(baseLayers, overlays, { collapsed: false }).addTo(map);
if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
else {
  map.setView([0, 0], 2);
  document.querySelector('#empty').hidden = false;
}
`;
}

export function archiveMapHtml(flights: readonly MapFlight[]): string {
  const { script, css, license } = leafletAssets();
  const data = JSON.stringify(flights).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src ${tileOrigins}">
<title>Drone Path archive</title>
<style>
${css}
html,body,#map{height:100%;margin:0}
#map{background:#f4f6f7}
#empty{position:absolute;z-index:1000;left:50%;top:1rem;transform:translateX(-50%);padding:.6rem 1rem;background:white;border:1px solid #aeb6bd;font:1rem system-ui,sans-serif}
</style>
</head>
<body>
<div id="map" aria-label="Flight map"></div>
<div id="empty" hidden>No tracks match this export.</div>
<script type="application/json" id="archive-data">${data}</script>
<!--
${license}
-->
<script>${script}</script>
<script>${mapClient()}</script>
</body>
</html>
`;
}
