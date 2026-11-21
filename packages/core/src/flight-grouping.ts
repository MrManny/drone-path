import { createHash } from 'node:crypto';
import path from 'node:path';

import { haversineM } from './geo.js';
import type { LatLon } from './geo.js';

interface TimedFix extends LatLon {
  tSec: number;
}

export interface FlightClip {
  key: string;
  size: number;
  startMs: number | null;
  durationSec: number | null;
  firstFix?: TimedFix;
  lastFix?: TimedFix;
}

export interface FlightMembership {
  key: string;
  flightId: string;
  order: number;
  splitFromKey: string | null;
}

interface TimedClip extends FlightClip {
  startMs: number;
  endMs: number;
  sequence: number;
}

const SPLIT_MIN_BYTES = 3_800_000_000;
const SPLIT_MAX_BYTES = 4_300_000_000;
// MP4 creation tags may have only whole-second precision.
const CLOCK_TOLERANCE_MS = 1000;

function groupableClip(clip: FlightClip): (TimedClip & { stream: string }) | null {
  const { key, startMs, durationSec } = clip;
  if (startMs === null || durationSec === null || !Number.isFinite(startMs) ||
      !Number.isFinite(durationSec) || durationSec <= 0) return null;
  const name = path.basename(key);
  const legacy = /^DJI_(\d{4})\.mp4$/iu.exec(name);
  const fly = /^dji_fly_\d{8}_\d{6}_(\d{4})_\d+_video\.mp4$/iu.exec(name);
  const match = legacy ?? fly;
  if (!match) return null;
  return {
    ...clip, startMs, endMs: startMs + durationSec * 1000,
    sequence: Number(match[1]),
    stream: JSON.stringify([path.dirname(key), legacy ? 'dji' : 'dji_fly']),
  };
}

function newFlight(key: string): FlightMembership {
  const id = createHash('sha256').update(key).digest('hex');
  return { key, flightId: id, order: 0, splitFromKey: null };
}

function continuation(previous: TimedClip, next: TimedClip, launch?: TimedFix): 'split' | 'flight' | null {
  const { firstFix: previousStart, lastFix } = previous;
  const { firstFix: nextStart } = next;
  const remainingSec = (previous.endMs - previous.startMs) / 1000 - (lastFix?.tSec ?? 0);
  if (!launch || !previousStart || !lastFix || !nextStart ||
      previousStart.tSec > 5 || nextStart.tSec > 5 || remainingSec < -1 || remainingSec > 5) return null;
  const gap = next.startMs - previous.endMs;
  if (gap < -CLOCK_TOLERANCE_MS || next.startMs === previous.startMs ||
      next.sequence !== (previous.sequence + 1) % 10_000) return null;
  const distance = haversineM(lastFix, nextStart);
  if (previous.size >= SPLIT_MIN_BYTES && previous.size <= SPLIT_MAX_BYTES &&
      gap <= 3000 && distance <= 30 && remainingSec <= 2 && nextStart.tSec <= 2) return 'split';
  // A return to the first clip's start can mark a landing or battery change.
  if (gap <= 45_000 && distance <= 100 && haversineM(launch, lastFix) > 12 &&
      (gap <= 10_000 || haversineM(launch, nextStart) <= 150)) return 'flight';
  return null;
}

function competingClips(clips: readonly TimedClip[]): Set<string> {
  const competing = new Set<string>();
  let latestEnding = clips[0];
  for (const clip of clips.slice(1)) {
    if (clip.startMs === latestEnding.startMs || clip.startMs < latestEnding.endMs - CLOCK_TOLERANCE_MS) {
      competing.add(clip.key);
      competing.add(latestEnding.key);
    }
    if (clip.endMs > latestEnding.endMs) latestEnding = clip;
  }
  return competing;
}

function groupStream(clips: TimedClip[], memberships: Map<string, FlightMembership>): void {
  clips.sort((a, b) => a.startMs - b.startMs || compareKeys(a.key, b.key));
  const competing = competingClips(clips);
  let launch = clips[0].firstFix;
  for (const [index, clip] of clips.entries()) {
    const previous = clips[index - 1];
    const link = previous && !competing.has(previous.key) && !competing.has(clip.key)
      ? continuation(previous, clip, launch)
      : null;
    if (link) {
      const prior = memberships.get(previous.key)!;
      memberships.set(clip.key, {
        key: clip.key, flightId: prior.flightId, order: prior.order + 1,
        splitFromKey: link === 'split' ? previous.key : null,
      });
    } else {
      launch = clip.firstFix;
    }
  }
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Infer flights from the available camera tags and GPS fixes in one library snapshot. */
export function groupFlights(clips: readonly FlightClip[]): FlightMembership[] {
  const memberships = new Map(clips.map(({ key }) => [key, newFlight(key)]));
  const streams = new Map<string, TimedClip[]>();
  for (const clip of clips) {
    const candidate = groupableClip(clip);
    if (!candidate) continue;
    const stream = streams.get(candidate.stream);
    if (stream) stream.push(candidate);
    else streams.set(candidate.stream, [candidate]);
  }
  for (const stream of streams.values()) groupStream(stream, memberships);
  return [...memberships.values()].sort((a, b) => compareKeys(a.key, b.key));
}
