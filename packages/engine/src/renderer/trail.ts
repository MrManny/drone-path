import type { LatLngTuple } from 'leaflet';

export interface TrailLayer {
  setLatLngs(points: LatLngTuple[]): void;
}

export interface TrailController {
  setFrame(i: number): void;
}

export interface TrailTrack {
  lat: readonly number[];
  lon: readonly number[];
  frame: readonly number[];
}

export interface FrameTrack {
  lat: readonly number[];
  lon: readonly number[];
}

export function lastIndexAtOrBefore(trailFrame: readonly number[], i: number): number {
  let lo = 0;
  let hi = trailFrame.length - 1;
  let k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (trailFrame[mid] <= i) {
      k = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return k;
}

export function createTrailController(
  trail: TrailTrack,
  frames: FrameTrack,
  layers: readonly TrailLayer[],
): TrailController {
  let lastFrame: number | null = null;
  let drawn = false;

  return {
    setFrame(i: number): void {
      if (i === lastFrame) return;
      const tip: [number, number] | null =
        i >= 0 && i < frames.lat.length ? [frames.lat[i], frames.lon[i]] : null;
      // A kept point at exactly frame i would duplicate the tip's position.
      let end = lastIndexAtOrBefore(trail.frame, i);
      if (tip !== null && trail.frame[end] === i) end -= 1;
      const points: Array<[number, number]> = [];
      for (let j = 0; j <= end; j++) points.push([trail.lat[j], trail.lon[j]]);
      if (tip !== null) points.push(tip);
      lastFrame = i;
      if (points.length === 0 && !drawn) return;
      drawn = points.length > 0;
      for (const layer of layers) layer.setLatLngs(points);
    },
  };
}
