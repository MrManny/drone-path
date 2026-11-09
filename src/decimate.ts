import { project } from './geo.js';
import type { Pixel } from './geo.js';

export interface DecimatedTrack {
  lat: number[];
  lon: number[];
  frame: number[];
}

export interface DecimateOptions {
  epsilonPx?: number;
  maxPoints?: number;
}

const DEFAULT_EPSILON_PX = 1;
const DEFAULT_MAX_POINTS = 3000;

export function decimateTrack(
  lat: readonly number[],
  lon: readonly number[],
  zoom: number,
  options: DecimateOptions = {},
): DecimatedTrack {
  const epsilonPx = options.epsilonPx ?? DEFAULT_EPSILON_PX;
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  if (!(epsilonPx >= 0)) throw new Error('epsilon must be >= 0');
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new Error('maxPoints must be an integer >= 2');
  }

  if (lat.length !== lon.length) {
    throw new Error('lat and lon must have the same length');
  }
  const n = lat.length;
  if (n === 0) return { lat: [], lon: [], frame: [] };
  if (n === 1) return { lat: [lat[0]], lon: [lon[0]], frame: [0] };

  const px: Pixel[] = new Array(n);
  for (let i = 0; i < n; i++) px[i] = project(lon[i], lat[i], zoom);

  let keep = douglasPeucker(px, epsilonPx);
  if (keep.length > maxPoints) {
    let hi = epsilonPx > 0 ? epsilonPx * 2 : 1;
    let hiKeep = douglasPeucker(px, hi);
    while (hiKeep.length > maxPoints) {
      hi *= 2;
      hiKeep = douglasPeucker(px, hi);
    }
    keep = hiKeep;
  }

  const track: DecimatedTrack = { lat: [], lon: [], frame: [] };
  for (const i of keep) {
    track.lat.push(lat[i]);
    track.lon.push(lon[i]);
    track.frame.push(i);
  }
  return track;
}

function douglasPeucker(px: readonly Pixel[], epsilon: number): number[] {
  const n = px.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const end = stack.pop() as number;
    const start = stack.pop() as number;
    if (end - start < 2) continue;
    const a = px[start];
    const b = px[end];
    const mid = (start + end) / 2;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(px[i], a, b);
      if (
        d > maxDist ||
        (d === maxDist && Math.abs(i - mid) < Math.abs(maxIdx - mid))
      ) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push(start, maxIdx, maxIdx, end);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) indices.push(i);
  return indices;
}

function distanceToSegment(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  );
  return Math.sqrt((p.x - (a.x + t * dx)) ** 2 + (p.y - (a.y + t * dy)) ** 2);
}
