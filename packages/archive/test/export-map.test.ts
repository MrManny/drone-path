import { Script } from 'node:vm';

import { expect, it } from 'vitest';

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
