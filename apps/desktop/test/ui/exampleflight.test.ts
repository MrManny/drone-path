import { describe, expect, it, vi } from 'vitest';

import { TILE_BASE } from '../../src/appurls.js';
import {
  getExampleFlight,
  EXAMPLE_FRAMES,
  EXAMPLE_FPS,
  exampleStateLabel,
} from '../../ui/lib/exampleflight.js';

const { channels, bbox, baseScene, meta, durationSec } = getExampleFlight();

describe('the bundled example flight', () => {
  it('covers every frame with one sample per channel', () => {
    expect(channels.lat).toHaveLength(EXAMPLE_FRAMES);
    expect(channels.lon).toHaveLength(EXAMPLE_FRAMES);
    expect(channels.alt).toHaveLength(EXAMPLE_FRAMES);
    expect(channels.speed).toHaveLength(EXAMPLE_FRAMES);
    expect(channels.headingDeg).toHaveLength(EXAMPLE_FRAMES);
    expect(durationSec).toBe(EXAMPLE_FRAMES / EXAMPLE_FPS);
  });

  it('holds finite values inside the plausible drone ranges', () => {
    const flat = [...channels.lat, ...channels.lon, ...(channels.alt as number[])];
    expect(flat.every((v) => Number.isFinite(v))).toBe(true);
    expect((channels.alt as number[]).every((a) => a > 0 && a < 400)).toBe(true);
    expect((channels.speed as number[]).every((s) => s !== null && s > 1 && s < 16)).toBe(true);
    expect(channels.headingDeg.every((h) => h >= 0 && h < 360)).toBe(true);
  });

  it('stays inside its planning bbox', () => {
    for (let i = 0; i < channels.lat.length; i++) {
      expect(channels.lat[i]).toBeGreaterThanOrEqual(bbox.minLat);
      expect(channels.lat[i]).toBeLessThanOrEqual(bbox.maxLat);
      expect(channels.lon[i]).toBeGreaterThanOrEqual(bbox.minLon);
      expect(channels.lon[i]).toBeLessThanOrEqual(bbox.maxLon);
    }
  });

  it('climbs, cruises high and descends, so the ALT chip reads varying values', () => {
    const alt = channels.alt as number[];
    expect(Math.max(...alt)).toBeGreaterThan(100);
    expect(alt[0]).toBeLessThan(40);
    expect(alt[alt.length - 1]).toBeLessThan(40);
    const highFrames = alt.filter((a) => a > 100).length;
    expect(highFrames).toBeGreaterThan(EXAMPLE_FRAMES / 10);
  });

  it('turns through every compass direction and varies the speed', () => {
    const buckets = new Set(channels.headingDeg.map((h) => Math.floor(h / 90)));
    expect(buckets.size).toBe(4);
    const speed = channels.speed as number[];
    expect(Math.max(...speed) - Math.min(...speed)).toBeGreaterThan(3);
  });

  it('names its state so it can never pass for the user recording', () => {
    expect(exampleStateLabel()).toContain('Example flight');
  });

  it('plans a preview scene at the export frame size on the app tile base', () => {
    expect(baseScene.width).toBe(1280);
    expect(baseScene.height).toBe(720);
    expect(baseScene.tileUrl).toBe(`${TILE_BASE}/satellite/{z}/{x}/{y}.png`);
    expect(baseScene.zoom).toBeGreaterThanOrEqual(2);
    expect(baseScene.zoom).toBeLessThanOrEqual(19);
    expect(meta.tileBase).toBe(TILE_BASE);
    expect(meta.frames).toBe(EXAMPLE_FRAMES);
    expect(meta.fps).toBe(EXAMPLE_FPS);
  });

  it('memoizes within a session and builds identically on every launch', async () => {
    expect(getExampleFlight()).toBe(getExampleFlight());
    vi.resetModules();
    const again = await import('../../ui/lib/exampleflight.js');
    expect(again.getExampleFlight().channels).toEqual(channels);
    expect(again.getExampleFlight().bbox).toEqual(bbox);
  });
});
