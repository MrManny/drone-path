import { zonedTimeMs } from 'drone-path-archive/camera-time';

import { leafName } from '../../shared/errors.js';
import type { ArchiveFlightDto } from '../../shared/ipc.js';

export type ArchiveSort = 'oldest' | 'newest';

export function archiveSidebar(flights: readonly ArchiveFlightDto[], search: string, sort: ArchiveSort) {
  const needle = search.trim().toLowerCase();
  let matchCount = 0;
  const visible = flights.flatMap((flight, index) => {
    if (flight.clips.length === 0) return [];
    const matches = needle
      ? new Set(flight.clips
          .map(({ path }) => path)
          .filter((path) => leafName(path).toLowerCase().includes(needle)))
      : null;
    if (matches?.size === 0) return [];
    matchCount += matches?.size ?? flight.clips.length;
    const firstTime = flight.clips[0]?.cameraCreationTime;
    const start = flight.startMs !== undefined ? flight.startMs : firstTime ? zonedTimeMs(firstTime) : null;
    return [{ flight, index, matches, start: Number.isFinite(start) ? start : null }];
  });

  visible.sort((a, b) => {
    if (a.start === null) return b.start === null ? 0 : 1;
    if (b.start === null) return -1;
    return sort === 'oldest' ? a.start - b.start : b.start - a.start;
  });

  const dates = new Map<string | null, typeof visible>();
  for (const item of visible) {
    const day = item.start === null ? null : new Date(item.start).toISOString().split('T')[0];
    const group = dates.get(day);
    if (group) group.push(item);
    else dates.set(day, [item]);
  }
  return { dates: [...dates], matchCount };
}
