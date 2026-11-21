import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  markerFormatOf,
  serializeDaVinciResolveCsv,
  serializeFcpxmlMarkers,
} from '../src/nle-markers.js';
import type { MarkerRange } from '../src/nle-markers.js';

const fps30 = { num: 30, den: 1, value: 30, str: '30' };
const fps2997 = { num: 30000, den: 1001, value: 30000 / 1001, str: '30000/1001' };

const sampleMarkers: MarkerRange[] = [
  {
    clipPath: '/flights/DJI_0001.MP4',
    fps: fps30,
    durationSec: 60,
    startSec: 2.5,
    endSec: 10,
    label: 'smooth-glide',
    note: 'smoothness 0.912, speed 4.50 m/s, yawRate 0.20 deg/s',
  },
  {
    clipPath: '/flights/DJI_0001.MP4',
    clipName: 'Lighthouse "Reveal", & More',
    fps: fps30,
    durationSec: 60,
    startSec: 12,
    endSec: 18.5,
    label: 'orbit',
    color: 'Green',
    note: '=SUM(A1:A2)\nline2',
  },
];

describe('markerFormatOf', () => {
  it('recognizes .csv and .fcpxml case-insensitively and rejects others', () => {
    expect(markerFormatOf('markers.csv')).toBe('csv');
    expect(markerFormatOf('MARKERS.FCPXML')).toBe('fcpxml');
    expect(() => markerFormatOf('markers.json')).toThrow('expected a .csv or .fcpxml output file');
    expect(() => markerFormatOf('markers')).toThrow('expected a .csv or .fcpxml output file');
  });
});

describe('serializeDaVinciResolveCsv', () => {
  it('writes deterministic DaVinci Resolve marker CSV with SMPTE timecodes and CSV/formula escaping', () => {
    const csv = serializeDaVinciResolveCsv(sampleMarkers);
    expect(serializeDaVinciResolveCsv(sampleMarkers)).toBe(csv);

    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('#,Clip Name,In,Out,Duration,Marker Color,Marker Name,Notes');
    expect(lines[1]).toBe(
      '1,DJI_0001.MP4,00:00:02:15,00:00:10:00,00:00:07:15,Blue,smooth-glide,"smoothness 0.912, speed 4.50 m/s, yawRate 0.20 deg/s"',
    );
    expect(lines[2]).toBe(
      '2,"Lighthouse ""Reveal"", & More",00:00:12:00,00:00:18:15,00:00:06:15,Green,orbit,"\'=SUM(A1:A2)',
    );
    expect(lines[3]).toBe('line2"');
  });

  it('handles empty marker lists with header only', () => {
    expect(serializeDaVinciResolveCsv([])).toBe(
      '#,Clip Name,In,Out,Duration,Marker Color,Marker Name,Notes\n',
    );
  });
});

describe('serializeFcpxmlMarkers', () => {
  it('produces deterministic FCPXML 1.10 with deduplicated assets, rational frame times, and XML escaping', () => {
    const xml = serializeFcpxmlMarkers([
      ...sampleMarkers,
      {
        clipPath: '/flights/DJI_0002.MP4',
        fps: fps2997,
        durationSec: 20,
        startSec: 1 / (30000 / 1001),
        endSec: 2 / (30000 / 1001),
        label: 'hover & <test>',
        note: '5\'6" view',
      },
    ]);
    expect(serializeFcpxmlMarkers([
      ...sampleMarkers,
      {
        clipPath: '/flights/DJI_0002.MP4',
        fps: fps2997,
        durationSec: 20,
        startSec: 1 / (30000 / 1001),
        endSec: 2 / (30000 / 1001),
        label: 'hover & <test>',
        note: '5\'6" view',
      },
    ])).toBe(xml);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">')).toBe(true);
    expect(xml).toContain('frameDuration="1/30s"');
    expect(xml).toContain('frameDuration="1001/30000s"');
    expect(xml.match(/<asset id="/gu)).toHaveLength(2);

    const expectedSrc = pathToFileURL(path.resolve('/flights/DJI_0001.MP4')).href;
    expect(xml).toContain(`src="${expectedSrc}"`);
    expect(xml).toContain('name="Lighthouse &quot;Reveal&quot;, &amp; More"');
    expect(xml).toContain('start="5/2s" duration="15/2s"');
    expect(xml).toContain('start="1001/30000s" duration="1001/30000s"');
    expect(xml).toContain('value="hover &amp; &lt;test&gt;" note="5&apos;6&quot; view"');
  });

  it('writes a valid empty FCPXML document when given no markers', () => {
    const xml = serializeFcpxmlMarkers([]);
    expect(xml).toContain('<fcpxml version="1.10">');
    expect(xml).toContain('<sequence format="r1" duration="0s">');
    expect(xml).toContain('<spine>');
  });
});

describe('marker validation', () => {
  const base: MarkerRange = {
    clipPath: 'clip.mp4',
    fps: fps30,
    durationSec: 10,
    startSec: 1,
    endSec: 3,
    label: 'orbit',
  };

  it.for([
    ['empty clipPath', { ...base, clipPath: '  ' }],
    ['empty label', { ...base, label: '' }],
    ['non-positive durationSec', { ...base, durationSec: 0 }],
    ['non-positive fps', { ...base, fps: { num: 0, den: 1, value: 0, str: '0' } }],
    ['negative startSec', { ...base, startSec: -0.1 }],
    ['startSec > endSec', { ...base, startSec: 4, endSec: 3 }],
    ['endSec > durationSec', { ...base, endSec: 10.1 }],
  ] as const)('rejects invalid marker (%s) in both serializers', ([_name, invalid]) => {
    expect(() => serializeDaVinciResolveCsv([invalid])).toThrow();
    expect(() => serializeFcpxmlMarkers([invalid])).toThrow();
  });
});
