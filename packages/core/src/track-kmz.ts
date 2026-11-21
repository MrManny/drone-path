// Deterministic KMZ packaging: a zip archive with exactly one stored (method 0)
// `doc.kml` entry and fixed zip metadata - 1980-01-01 00:00 entry timestamps,
// no extra fields, no comments. Stored entries keep the bytes independent of
// any compressor version, so the same KML always produces the same KMZ.

import { crc32 } from 'node:zlib';

const ENTRY_NAME = 'doc.kml';
// The zip epoch (1980-01-01 00:00:00) in MS-DOS date/time fields.
const DOS_DATE_1980_01_01 = 0x0021;
const DOS_TIME_MIDNIGHT = 0x0000;

function writeCommonEntryFields(
  buf: Buffer,
  offset: number,
  crc: number,
  dataLength: number,
  nameLength: number,
): void {
  buf.writeUInt16LE(20, offset); // version needed: 2.0
  buf.writeUInt16LE(0, offset + 2); // flags
  buf.writeUInt16LE(0, offset + 4); // method: stored
  buf.writeUInt16LE(DOS_TIME_MIDNIGHT, offset + 6);
  buf.writeUInt16LE(DOS_DATE_1980_01_01, offset + 8);
  buf.writeUInt32LE(crc, offset + 10);
  buf.writeUInt32LE(dataLength, offset + 14);
  buf.writeUInt32LE(dataLength, offset + 18);
  buf.writeUInt16LE(nameLength, offset + 22);
  buf.writeUInt16LE(0, offset + 24); // extra field length
}

function localHeader(name: Buffer, data: Buffer, crc: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  writeCommonEntryFields(header, 4, crc, data.length, name.length);
  return Buffer.concat([header, name, data]);
}

function centralDirectoryEntry(
  name: Buffer,
  dataLength: number,
  crc: number,
  offset: number,
): Buffer {
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4); // version made by: 2.0, MS-DOS
  writeCommonEntryFields(entry, 6, crc, dataLength, name.length);
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
  const crc = crc32(data);
  const local = localHeader(name, data, crc);
  const central = centralDirectoryEntry(name, data.length, crc, 0);
  return Buffer.concat([
    local,
    central,
    endOfCentralDirectory(1, central.length, local.length),
  ]);
}
