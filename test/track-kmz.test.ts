import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { serializeKml } from '../src/track-kml.js';
import { kmzBytes } from '../src/track-kmz.js';
import { buildTrack } from '../src/track.js';
import { TRACK_KMZ_GOLDEN_HEX, TRACK_ROWS } from './fixtures.js';

const kml = serializeKml(buildTrack(TRACK_ROWS));

interface ZipEntry {
  name: string;
  payload: Buffer;
  method: number;
  time: number;
  date: number;
  crc: number;
}

function parseSingleStoredEntry(bytes: Buffer): ZipEntry {
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  const method = bytes.readUInt16LE(8);
  const time = bytes.readUInt16LE(10);
  const date = bytes.readUInt16LE(12);
  const crc = bytes.readUInt32LE(14);
  const size = bytes.readUInt32LE(18);
  const nameLen = bytes.readUInt16LE(26);
  expect(bytes.readUInt16LE(28)).toBe(0); // no extra field
  const name = bytes.subarray(30, 30 + nameLen).toString('utf8');
  const payload = bytes.subarray(30 + nameLen, 30 + nameLen + size);
  return { name, payload, method, time, date, crc };
}

describe('kmzBytes', () => {
  it('matches the golden bytes', () => {
    expect(kmzBytes(kml).toString('hex')).toBe(TRACK_KMZ_GOLDEN_HEX);
  });

  it('is deterministic', () => {
    expect(kmzBytes(kml).equals(kmzBytes(kml))).toBe(true);
  });

  it('wraps one stored doc.kml entry with fixed 1980-01-01 timestamps', () => {
    const bytes = kmzBytes(kml);
    const entry = parseSingleStoredEntry(bytes);
    expect(entry.name).toBe('doc.kml');
    expect(entry.method).toBe(0); // stored, never compressed
    expect(entry.time).toBe(0); // midnight
    expect(entry.date).toBe(0x0021); // 1980-01-01
    expect(entry.payload.toString('utf8')).toBe(kml);
    expect(entry.crc).toBe(crc32(entry.payload));

    const eocd = bytes.length - 22;
    expect(bytes.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(bytes.readUInt16LE(eocd + 8)).toBe(1); // entries on disk
    expect(bytes.readUInt16LE(eocd + 10)).toBe(1); // total entries
    const cdOffset = bytes.readUInt32LE(eocd + 16);
    expect(cdOffset + bytes.readUInt32LE(eocd + 12)).toBe(eocd);
    expect(bytes.readUInt32LE(cdOffset)).toBe(0x02014b50);
    expect(bytes.readUInt16LE(cdOffset + 10)).toBe(0); // stored
    expect(bytes.readUInt16LE(cdOffset + 12)).toBe(0); // time
    expect(bytes.readUInt16LE(cdOffset + 14)).toBe(0x0021); // 1980-01-01
    expect(bytes.readUInt32LE(cdOffset + 16)).toBe(entry.crc);
    expect(bytes.readUInt32LE(cdOffset + 42)).toBe(0); // local header offset
    const cdNameLen = bytes.readUInt16LE(cdOffset + 28);
    expect(bytes.subarray(cdOffset + 46, cdOffset + 46 + cdNameLen).toString('utf8')).toBe(
      'doc.kml',
    );
  });
});
