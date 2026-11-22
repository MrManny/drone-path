import { Script } from 'node:vm';

import { expect, it, vi } from 'vitest';

import { archiveMapHtml } from '../src/export-map.js';

it('embeds licensed Leaflet, escapes embedded JSON, and emits valid inline scripts', () => {
  const flights = [{
    clips: [{
      label: '</script><img>',
      availability: 'online' as const,
      track: [[{ lat: 1, lon: 2 }]],
      gaze: [],
    }],
  }];
  const html = archiveMapHtml(flights);
  expect(archiveMapHtml(flights)).toBe(html);
  expect(html).toContain('Redistribution and use');
  expect(html).not.toMatch(/<(?:script|link)\b[^>]*(?:src|href)=/u);
  expect(html).not.toContain('sourceMappingURL=');
  expect(html).not.toContain('</script><img>');
  const json = /<script type="application\/json" id="archive-data">(.+)<\/script>/u.exec(html)?.[1];
  expect(JSON.parse(json!)).toEqual(flights);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
  expect(scripts).toHaveLength(2);
  for (const match of scripts) expect(() => new Script(match[1])).not.toThrow();
});

it('offers both basemaps and a blank background alongside camera footprints', () => {
  const point = { lat: 46, lon: 14 };
  const flights = [{ clips: [{ track: [[point]], gaze: [[point]] }] }];
  const html = archiveMapHtml(flights);
  expect(html).toContain(
    "img-src https://server.arcgisonline.com https://a.tile.opentopomap.org " +
    'https://b.tile.opentopomap.org https://c.tile.opentopomap.org',
  );

  const map = { fitBounds() {} };
  const activeLayers = new Set<unknown>();
  const layer = () => ({
    addTo(target: unknown) {
      if (target === map) activeLayers.add(this);
      return this;
    },
    bindPopup() { return this; },
  });
  const tileLayer = (url: string, options: { attribution: string }) => ({ ...layer(), url, ...options });
  const layers = vi.fn((_baseLayers: Record<string, unknown>, _overlays: Record<string, unknown>) => layer());
  const client = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].at(-1)?.[1];
  new Script(client!).runInNewContext({
    document: { querySelector: () => ({ textContent: JSON.stringify(flights) }) },
    L: {
      map: () => map,
      latLngBounds: () => ({ extend() {}, isValid: () => true }),
      tileLayer,
      layerGroup: layer,
      circleMarker: layer,
      polygon: layer,
      control: { layers },
    },
  });

  expect(layers).toHaveBeenCalledWith({
    'Esri imagery': expect.objectContaining({
      url: expect.stringContaining('World_Imagery'),
      attribution: expect.stringContaining('Esri'),
    }),
    Topographic: expect.objectContaining({
      url: expect.stringContaining('opentopomap.org'),
      maxNativeZoom: 17,
      attribution: expect.stringContaining('OpenTopoMap'),
    }),
    'No basemap': expect.any(Object),
  }, { 'Camera footprints': expect.any(Object) }, { collapsed: false });
  const [baseLayers, overlays] = layers.mock.calls[0];
  expect(activeLayers.has(baseLayers['Esri imagery'])).toBe(true);
  expect(activeLayers.has(baseLayers.Topographic)).toBe(false);
  expect(activeLayers.has(baseLayers['No basemap'])).toBe(false);
  expect(activeLayers.has(overlays['Camera footprints'])).toBe(true);
});
