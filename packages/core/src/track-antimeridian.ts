import type { LatLon } from './geo.js';

export function splitTrackAtAntimeridian(segments: readonly (readonly LatLon[])[]): LatLon[][] {
  const split: LatLon[][] = [];
  for (const segment of segments) {
    const [first, ...points] = segment;
    if (!first) continue;
    let run = [first];
    let previous = first;
    for (const point of points) {
      const delta = point.lon - previous.lon;
      if (Math.abs(delta) > 180) {
        const boundary = delta < 0 ? 180 : -180;
        const endLon = point.lon + 2 * boundary;
        const step = endLon - previous.lon;
        const progress = step === 0 ? 0 : (boundary - previous.lon) / step;
        const lat = previous.lat + (point.lat - previous.lat) * progress;
        if (progress > 0) run.push({ lat, lon: boundary });
        split.push(run);
        run = progress < 1 ? [{ lat, lon: -boundary }] : [];
      }
      run.push(point);
      previous = point;
    }
    split.push(run);
  }
  return split;
}
