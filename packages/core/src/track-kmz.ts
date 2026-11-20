// Deterministic KMZ packaging: a zip archive with exactly one stored (method 0)
// `doc.kml` entry and fixed zip metadata - 1980-01-01 00:00 entry timestamps,
// no extra fields, no comments. Stored entries keep the bytes independent of
// any compressor version, so the same KML always produces the same KMZ.

import { crc32 } from 'node:zlib';

const ENTRY_NAME = 'doc.kml';
// The zip epoch (1980-01-01 00:00:00) in MS-DOS date/time fields.
const DOS_DATE_1980_01_01 = 0x0021;
const DOS_TIME_MIDNIGHT = 0x0000;

function localHeader(name: Buffer, data: Buffer): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed: 2.0
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(0, 8); // method: stored
  header.writeUInt16LE(DOS_TIME_MIDNIGHT, 10);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([header, name, data]);
}

function centralDirectoryEntry(name: Buffer, data: Buffer, offset: number): Buffer {
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4); // version made by: 2.0, MS-DOS
  entry.writeUInt16LE(20, 6); // version needed: 2.0
  entry.writeUInt16LE(0, 8); // flags
  entry.writeUInt16LE(0, 10); // method: stored
  entry.writeUInt16LE(DOS_TIME_MIDNIGHT, 12);
  entry.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  entry.writeUInt32LE(crc32(data), 16);
  entry.writeUInt32LE(data.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt16LE(0, 30); // extra field length
  entry.writeUInt16LE(0, 32); // comment length
  entry.writeUInt16LE(0, 34); // disk number start
  entry.writeUInt16LE(0, 36); // internal attributes
  entry.writeUInt32LE(0, 38); // external attributes
  entry.writeUInt32LE(offset, 42);
  return Buffer.concat([entry, name]);
}

function endOfCentralDirectory(entryCount: number, cdSize: number, cdOffset: number): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return eocd;
}

export function kmzBytes(kml: string): Buffer {
  const name = Buffer.from(ENTRY_NAME, 'utf8');
  const data = Buffer.from(kml, 'utf8');
  const local = localHeader(name, data);
  const central = centralDirectoryEntry(name, data, 0);
  return Buffer.concat([
    local,
    central,
    endOfCentralDirectory(1, central.length, local.length),
  ]);
}
