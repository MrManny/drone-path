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

it.each([false, true])('renders the expected map layers with offline=%s', (offline) => {
  const point = { lat: 46, lon: 14 };
  const flights = [{ clips: [{ track: [[point]], gaze: [[point]] }] }];
  const html = archiveMapHtml(flights, { offline });
  if (offline) {
    expect(html).toContain("img-src 'none'");
    expect(html).not.toContain('opentopomap.org');
    expect(html).not.toContain('arcgis.com');
    expect(html).not.toContain('<form');
  } else {
    expect(html).toContain(
      'img-src https://ibasemaps-api.arcgis.com https://a.tile.opentopomap.org ' +
      'https://b.tile.opentopomap.org https://c.tile.opentopomap.org',
    );
  }

  const activeLayers = new Set<object>();
  const map = { fitBounds() {}, on: vi.fn(), hasLayer: (target: object) => activeLayers.has(target) };
  const layer = () => ({
    addTo(target: unknown) {
      if (target === map) activeLayers.add(this);
      return this;
    },
    bindPopup() { return this; },
    clearLayers() {},
    on() { return this; },
  });
  const tileLayer = vi.fn((url: string, options: { attribution: string }) => ({ ...layer(), url, ...options }));
  const layers = vi.fn((_baseLayers: Record<string, unknown>, _overlays: Record<string, unknown>) => layer());
  const credentials = { addEventListener: vi.fn() };
  const apiKey = { value: 'test+/&key' };
  const elements = {
    '#archive-data': { textContent: JSON.stringify(flights) },
    '#esri-credentials': credentials,
    '#esri-key': apiKey,
    '#esri-tile-error': { hidden: true },
  };
  const client = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].at(-1)?.[1];
  new Script(client!).runInNewContext({
    document: { querySelector: (selector: keyof typeof elements) => elements[selector] },
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

  expect(layers).toHaveBeenCalledWith(offline ? {} : {
    'Esri imagery': expect.any(Object),
    Topographic: expect.objectContaining({
      url: expect.stringContaining('opentopomap.org'),
      maxNativeZoom: 17,
      attribution: expect.stringContaining('OpenTopoMap'),
    }),
    'No basemap': expect.any(Object),
  }, { 'Camera footprints': expect.any(Object) }, { collapsed: false });
  const [baseLayers, overlays] = layers.mock.calls[0];
  expect(activeLayers).toContain(overlays['Camera footprints']);
  if (offline) {
    expect(tileLayer).not.toHaveBeenCalled();
    return;
  }
  expect(activeLayers).toContain(baseLayers.Topographic);
  expect(activeLayers).not.toContain(baseLayers['Esri imagery']);
  expect(activeLayers).not.toContain(baseLayers['No basemap']);
  expect(tileLayer).toHaveBeenCalledTimes(1);

  activeLayers.add(baseLayers['Esri imagery'] as object);
  const submit = credentials.addEventListener.mock.calls[0][1];
  const preventDefault = vi.fn();
  submit({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(apiKey.value).toBe('');
  expect(tileLayer).toHaveBeenLastCalledWith(
    expect.stringContaining('World_Imagery/MapServer/tile/{z}/{y}/{x}?token=test%2B%2F%26key'),
    expect.objectContaining({ attribution: expect.stringMatching(/Powered by Esri.*Vantor/u) }),
  );
});
