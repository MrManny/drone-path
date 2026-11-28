import { clampMercatorLatitude, project } from 'drone-path-core/geo';
import type { Bbox } from 'drone-path-core/geo';

import type {
  ArchiveFlightClipDto,
  ArchiveFlightDto,
  ArchiveTrackPoint,
} from '../../shared/ipc.js';

export const ARCHIVE_CLUSTER_MAX_ZOOM = 11;
export const DEFAULT_CLUSTER_RADIUS_PX = 48;

export interface ArchiveMapClipItem {
  clip: ArchiveFlightClipDto;
  flightId: string;
  flightIndex: number;
  lat: number;
  lon: number;
  bounds: Bbox;
  track: ArchiveTrackPoint[][];
}

export interface ArchiveMapCluster {
  id: string;
  lat: number;
  lon: number;
  count: number;
  clipPaths: string[];
  bounds: Bbox;
}

export interface ArchiveClusterOptions {
  maxZoom?: number;
  radiusPx?: number;
}

export interface ArchiveClusterResult {
  clusters: ArchiveMapCluster[];
  items: ArchiveMapClipItem[];
}

function wrapLon(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  if (lon >= -180 && lon <= 180) return lon;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

function boundsFromTrack(track: readonly (readonly ArchiveTrackPoint[])[]): Bbox | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let count = 0;

  for (const segment of track) {
    for (const pt of segment) {
      if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
      minLat = Math.min(minLat, pt.lat);
      maxLat = Math.max(maxLat, pt.lat);
      minLon = Math.min(minLon, pt.lon);
      maxLon = Math.max(maxLon, pt.lon);
      count += 1;
    }
  }

  return count > 0 ? { minLat, maxLat, minLon, maxLon } : null;
}

function centroidOfClip(bounds: Bbox, track: readonly (readonly ArchiveTrackPoint[])[]): { lat: number; lon: number } {
  const lat = clampMercatorLatitude((bounds.minLat + bounds.maxLat) / 2);
  if (bounds.minLon <= bounds.maxLon) {
    return { lat, lon: wrapLon((bounds.minLon + bounds.maxLon) / 2) };
  }
  const firstPoint = track.find((seg) => seg.length > 0)?.[0];
  return {
    lat: firstPoint ? clampMercatorLatitude(firstPoint.lat) : lat,
    lon: firstPoint ? wrapLon(firstPoint.lon) : wrapLon(bounds.minLon),
  };
}

export function extractClipSpatialItems(flights: readonly ArchiveFlightDto[]): ArchiveMapClipItem[] {
  const items: ArchiveMapClipItem[] = [];
  for (const [flightIndex, flight] of flights.entries()) {
    for (const clip of flight.clips) {
      const bounds = clip.bbox ?? boundsFromTrack(clip.track);
      if (!bounds) continue;
      const { lat, lon } = centroidOfClip(bounds, clip.track);
      items.push({
        clip,
        flightId: flight.flightId,
        flightIndex,
        lat,
        lon,
        bounds,
        track: clip.track,
      });
    }
  }
  return items;
}

export function computeItemsBounds(items: readonly ArchiveMapClipItem[]): Bbox | null {
  if (items.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const { bounds } of items) {
    minLat = Math.min(minLat, bounds.minLat);
    maxLat = Math.max(maxLat, bounds.maxLat);
    if (bounds.minLon <= bounds.maxLon) {
      minLon = Math.min(minLon, bounds.minLon);
      maxLon = Math.max(maxLon, bounds.maxLon);
    } else {
      minLon = -180;
      maxLon = 180;
    }
  }
  return Number.isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;
}

function mergeBounds(a: Bbox, b: Bbox): Bbox {
  const minLat = Math.min(a.minLat, b.minLat);
  const maxLat = Math.max(a.maxLat, b.maxLat);
  if (a.minLon <= a.maxLon && b.minLon <= b.maxLon) {
    return {
      minLat,
      maxLat,
      minLon: Math.min(a.minLon, b.minLon),
      maxLon: Math.max(a.maxLon, b.maxLon),
    };
  }
  return { minLat, maxLat, minLon: -180, maxLon: 180 };
}

interface MutableCluster {
  anchorX: number;
  anchorY: number;
  sumLat: number;
  sumLon: number;
  bounds: Bbox;
  members: ArchiveMapClipItem[];
}

export function clusterArchiveClips(
  items: readonly ArchiveMapClipItem[],
  zoom: number,
  options: ArchiveClusterOptions = {},
): ArchiveClusterResult {
  if (items.length === 0) return { clusters: [], items: [] };

  const maxZoom = options.maxZoom ?? ARCHIVE_CLUSTER_MAX_ZOOM;
  const radiusPx = Math.max(8, options.radiusPx ?? DEFAULT_CLUSTER_RADIUS_PX);
  const clampedZoom = Math.max(0, Math.min(22, zoom));

  if (clampedZoom > maxZoom) {
    return { clusters: [], items: [...items] };
  }

  const sorted = [...items].sort((a, b) =>
    a.clip.path < b.clip.path ? -1 : a.clip.path > b.clip.path ? 1 : 0,
  );
  const grid = new Map<string, MutableCluster[]>();
  const allGroups: MutableCluster[] = [];

  for (const item of sorted) {
    const { x, y } = project(item.lon, item.lat, clampedZoom);
    const gx = Math.floor(x / radiusPx);
    const gy = Math.floor(y / radiusPx);

    let nearest: MutableCluster | null = null;
    let nearestDistSq = radiusPx * radiusPx;

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const cell = grid.get(`${gx + dx}:${gy + dy}`);
        if (!cell) continue;
        for (const candidate of cell) {
          const distSq = (x - candidate.anchorX) ** 2 + (y - candidate.anchorY) ** 2;
          if (distSq <= nearestDistSq) {
            nearestDistSq = distSq;
            nearest = candidate;
          }
        }
      }
    }

    if (nearest) {
      nearest.sumLat += item.lat;
      nearest.sumLon += item.lon;
      nearest.bounds = mergeBounds(nearest.bounds, item.bounds);
      nearest.members.push(item);
    } else {
      const created: MutableCluster = {
        anchorX: x,
        anchorY: y,
        sumLat: item.lat,
        sumLon: item.lon,
        bounds: item.bounds,
        members: [item],
      };
      const key = `${gx}:${gy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(created);
      else grid.set(key, [created]);
      allGroups.push(created);
    }
  }

  const clusters: ArchiveMapCluster[] = [];
  const unclustered: ArchiveMapClipItem[] = [];

  for (const group of allGroups) {
    if (group.members.length === 1) {
      unclustered.push(group.members[0]);
      continue;
    }
    const count = group.members.length;
    const clipPaths = group.members.map((m) => m.clip.path);
    clusters.push({
      id: `cluster:${clipPaths[0]}:${count}`,
      lat: group.sumLat / count,
      lon: group.sumLon / count,
      count,
      clipPaths,
      bounds: group.bounds,
    });
  }

  return { clusters, items: unclustered };
}
