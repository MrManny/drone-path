// Trail growth state machine shared by the headless renderer and the app: at
// frame i the trail is the flown path so far - the decimated prefix before i
// plus the live tip at the frame's own position. The tip tracks the drone so
// the trail grows every frame (a prefix of decimated points alone stays empty
// for whole flights whenever the geometry collapses, #95), while the kept
// prefix stays bounded by the decimation budget. A changed frame pushes one
// setLatLngs per layer; repeated frames and empty tracks stay quiet.

export interface TrailLayer {
  /** Leaflet's setLatLngs takes one point list of <LatLng> ([lat, lon]). */
  setLatLngs(points: Array<[number, number]>): void;
}

export interface TrailController {
  /** Aligns every layer's trail with the flown path up to frame i. */
  setFrame(i: number): void;
}

/** The decimated flown path: kept points and their source frame indices. */
export interface TrailTrack {
  lat: readonly number[];
  lon: readonly number[];
  frame: readonly number[];
}

/** Per-frame positions, index-aligned to video frames (the drone's path). */
export interface FrameTrack {
  lat: readonly number[];
  lon: readonly number[];
}

// Largest k with trailFrame[k] <= i (trailFrame is strictly increasing):
// the textbook upper bound stepped back one; -1 when every point is later.
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
      // The tip already carries the frame's own position, so a kept point at
      // exactly frame i would only duplicate it.
      let end = lastIndexAtOrBefore(trail.frame, i);
      if (tip !== null && trail.frame[end] === i) end -= 1;
      const points: Array<[number, number]> = [];
      for (let j = 0; j <= end; j++) points.push([trail.lat[j], trail.lon[j]]);
      if (tip !== null) points.push(tip);
      lastFrame = i;
      // Fresh layers already hold an empty path; only clear what was drawn.
      if (points.length === 0 && !drawn) return;
      drawn = points.length > 0;
      for (const layer of layers) layer.setLatLngs(points);
    },
  };
}
