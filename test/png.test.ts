import zlib from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { solidPng } from '../src/png.js';

// The PNG spec fixes the empty IEND chunk, so its CRC-32 is a well-known
// constant: an independent check that the emitted checksums are standard CRC-32.
const IEND_CHUNK = [
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

interface PngChunk {
  type: string;
  data: Buffer;
  crc: number;
}

function readChunks(png: Buffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  let pos = 8;
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    chunks.push({
      type: png.toString('ascii', pos + 4, pos + 8),
      data: png.subarray(pos + 8, pos + 8 + length),
      crc: png.readUInt32BE(pos + 8 + length),
    });
    pos += 12 + length;
  }
  return chunks;
}

function chunkCrc(chunk: PngChunk): number {
  return zlib.crc32(Buffer.concat([Buffer.from(chunk.type, 'ascii'), chunk.data]));
}

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

describe('solidPng', () => {
  it('writes a valid PNG signature and 256x256 IHDR', () => {
    const buf = solidPng('#2a2f38');
    expect([...buf.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(buf.readUInt32BE(16)).toBe(256);
    expect(buf.readUInt32BE(20)).toBe(256);
  });
});

describe.for([
  { hex: '#2a2f38', size: 256 },
  { hex: '#ff0000', size: 2 },
  { hex: '#00ff80', size: 1 },
])('solidPng($hex, $size)', ({ hex, size }) => {
  it('emits IHDR, IDAT and IEND chunks with valid CRC-32 checksums', () => {
    const chunks = readChunks(solidPng(hex, size));
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const chunk of chunks) {
      expect(chunk.crc).toBe(chunkCrc(chunk));
    }
  });

  it('ends with the fixed IEND chunk', () => {
    const png = solidPng(hex, size);
    expect([...png.subarray(-12)]).toEqual(IEND_CHUNK);
  });

  it('describes an 8-bit RGB image of the requested size', () => {
    const ihdr = readChunks(solidPng(hex, size))[0].data;
    expect(ihdr.readUInt32BE(0)).toBe(size);
    expect(ihdr.readUInt32BE(4)).toBe(size);
    expect([ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]]).toEqual([8, 2, 0, 0, 0]);
  });

  it('inflates to one filter-0 RGB scanline per row', () => {
    const idat = readChunks(solidPng(hex, size))[1].data;
    const [r, g, b] = rgb(hex);
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    const expected = Buffer.concat(Array.from({ length: size }, () => row));
    expect(zlib.inflateSync(idat)).toEqual(expected);
  });
});
