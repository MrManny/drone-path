import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createOutputGuard, resolveSavePath } from '../src/outputguard.js';

describe('resolveSavePath', () => {
  const TRACK = ['gpx', 'geojson', 'kml', 'kmz', 'json'];
  it.for([
    { typed: 'a', extensions: ['json'], defaultExtension: 'json', want: 'a.json' },
    { typed: 'a.json', extensions: ['json'], defaultExtension: 'json', want: 'a.json' },
    { typed: 'A.JSON', extensions: ['json'], defaultExtension: 'json', want: 'A.JSON' },
    { typed: 'telemetry-test.csv', extensions: ['json'], defaultExtension: 'json', want: 'telemetry-test.csv.json' },
    { typed: 'flight.telemetry', extensions: ['json'], defaultExtension: 'json', want: 'flight.telemetry.json' },
    { typed: 'map', extensions: ['mp4'], defaultExtension: 'mp4', want: 'map.mp4' },
    { typed: 'map.MP4', extensions: ['mp4'], defaultExtension: 'mp4', want: 'map.MP4' },
    { typed: 'map.mov', extensions: ['mp4'], defaultExtension: 'mp4', want: 'map.mov.mp4' },
    { typed: 'flight', extensions: TRACK, defaultExtension: 'json', want: 'flight.json' },
    { typed: 'flight.GPX', extensions: TRACK, defaultExtension: 'json', want: 'flight.GPX' },
    { typed: 'flight.geojson', extensions: TRACK, defaultExtension: 'json', want: 'flight.geojson' },
    { typed: 'flight.kmz', extensions: TRACK, defaultExtension: 'json', want: 'flight.kmz' },
    { typed: 'notes.csv', extensions: TRACK, defaultExtension: 'json', want: 'notes.csv.json' },
  ])('resolves $typed to $want', ({ typed, extensions, defaultExtension, want }) => {
    expect(resolveSavePath(typed, extensions, defaultExtension)).toBe(want);
  });
});

describe('createOutputGuard', () => {
  const approvedExport = path.resolve('exports', 'flight_map.mp4');
  const otherExport = path.resolve('exports', 'other.mp4');
  const approvedTrack = path.resolve('exports', 'flight.telemetry.json');
  const otherTrack = path.resolve('exports', 'other.json');
  const approvedArchiveExport = path.resolve('exports', 'archive.gpx');
  const otherArchiveExport = path.resolve('exports', 'other.gpx');

  it('approves and consumes export, track, and archive export paths once', () => {
    const guard = createOutputGuard();

    guard.approveExport(approvedExport);
    expect(guard.consumeExport(approvedExport)).toBe(approvedExport);
    expect(() => guard.consumeExport(approvedExport)).toThrow('output path was not approved by save dialog');

    guard.approveTrack(approvedTrack);
    expect(guard.consumeTrack(approvedTrack)).toBe(approvedTrack);
    expect(() => guard.consumeTrack(approvedTrack)).toThrow('output path was not approved by save dialog');

    guard.approveArchiveExport(approvedArchiveExport);
    expect(guard.consumeArchiveExport(approvedArchiveExport)).toBe(approvedArchiveExport);
    expect(() => guard.consumeArchiveExport(approvedArchiveExport)).toThrow('output path was not approved by save dialog');
  });

  it('clears pending approvals on mismatch, cancel, or new recording', () => {
    const guard = createOutputGuard();

    guard.approveExport(approvedExport);
    expect(() => guard.consumeExport(otherExport)).toThrow('output path was not approved by save dialog');
    expect(() => guard.consumeExport(approvedExport)).toThrow('output path was not approved by save dialog');

    guard.approveExport(approvedExport);
    guard.approveTrack(approvedTrack);
    guard.approveArchiveExport(approvedArchiveExport);
    guard.clearPending();
    expect(() => guard.consumeExport(approvedExport)).toThrow('output path was not approved by save dialog');
    expect(() => guard.consumeTrack(approvedTrack)).toThrow('output path was not approved by save dialog');
    expect(() => guard.consumeArchiveExport(approvedArchiveExport)).toThrow('output path was not approved by save dialog');

    guard.approveTrack('relative/out.json');
    expect(() => guard.consumeTrack('relative/out.json')).toThrow('output path was not approved by save dialog');
    expect(() => guard.consumeTrack(otherTrack)).toThrow('output path was not approved by save dialog');

    guard.approveArchiveExport(approvedArchiveExport);
    guard.clearPendingArchiveExport();
    expect(() => guard.consumeArchiveExport(otherArchiveExport)).toThrow('output path was not approved by save dialog');
  });

  it('allows revealing or opening only recorded export, track, or archive export outputs', () => {
    const guard = createOutputGuard();
    expect(() => guard.knownOutputOf({ out: approvedExport })).toThrow('unknown output');
    expect(() => guard.knownOutputOf(null)).toThrow('unknown output');
    expect(() => guard.knownOutputOf({ out: 42 })).toThrow('unknown output');

    guard.recordExportOut(approvedExport);
    guard.recordTrackOut(approvedTrack);
    guard.recordArchiveExportOut(approvedArchiveExport);
    expect(guard.knownOutputOf({ out: approvedExport })).toBe(approvedExport);
    expect(guard.knownOutputOf({ out: approvedTrack })).toBe(approvedTrack);
    expect(guard.knownOutputOf({ out: approvedArchiveExport })).toBe(approvedArchiveExport);
    expect(() => guard.knownOutputOf({ out: otherExport })).toThrow('unknown output');
  });
});
