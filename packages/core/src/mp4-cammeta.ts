import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

import type { CamMetaPacket } from './cammeta-decode.js';

// Keep the optimization bounded. Larger or uncommon layouts use the tool path.
const MAX_BOX_BYTES = 64 * 1024 * 1024;
const MAX_CAM_BYTES = 128 * 1024 * 1024;
const MAX_SAMPLES = 1_000_000;
const MAX_TOP_LEVEL_BOXES = 4096;

interface Box {
  type: string;
  payload: number;
  end: number;
}

interface Chunk {
  offset: number;
  size: number;
}

interface CamMetaTrack {
  buffer: Buffer;
  packets: CamMetaPacket[];
}

class UnsupportedLayout extends Error {}

function requireLayout(ok: unknown): asserts ok {
  if (!ok) throw new UnsupportedLayout('unsupported mp4 sample layout');
}

function boxAt(header: Buffer, offset: number, end: number): Box {
  const shortSize = header.readUInt32BE(0);
  const headerSize = shortSize === 1 ? 16 : 8;
  const size = shortSize === 1
    ? Number(header.readBigUInt64BE(8))
    : shortSize || end - offset;
  requireLayout(Number.isSafeInteger(size) && size >= headerSize && size <= end - offset);
  return {
    type: header.toString('latin1', 4, 8),
    payload: offset + headerSize,
    end: offset + size,
  };
}

function childBoxes(container: Buffer): Box[] {
  const boxes: Box[] = [];
  for (let offset = 0; offset < container.length;) {
    const child = boxAt(container.subarray(offset, offset + 16), offset, container.length);
    boxes.push(child);
    offset = child.end;
  }
  return boxes;
}

function getBox(container: Buffer, boxes: Box[], type: string): Buffer {
  const matches = boxes.filter((box) => box.type === type);
  requireLayout(matches.length === 1);
  return container.subarray(matches[0].payload, matches[0].end);
}

function getChild(container: Buffer, type: string): Buffer {
  return getBox(container, childBoxes(container), type);
}

async function readExactly(file: FileHandle, buffer: Buffer, position: number): Promise<void> {
  for (let offset = 0; offset < buffer.length;) {
    const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, position + offset);
    requireLayout(bytesRead > 0);
    offset += bytesRead;
  }
}

async function readTopLevel(file: FileHandle, size: number): Promise<Box[]> {
  const boxes: Box[] = [];
  for (let offset = 0; offset < size;) {
    requireLayout(boxes.length < MAX_TOP_LEVEL_BOXES);
    const header = Buffer.alloc(Math.min(16, size - offset));
    await readExactly(file, header, offset);
    const box = boxAt(header, offset, size);
    boxes.push(box);
    offset = box.end;
  }
  return boxes;
}

function readTrackField(header: Buffer): number {
  const version = header.readUInt8(0);
  requireLayout(version === 0 || version === 1);
  return header.readUInt32BE(version === 0 ? 12 : 20);
}

function findTrack(movie: Buffer, boxes: Box[], trackId: number): Buffer {
  for (const box of boxes) {
    if (box.type !== 'trak') continue;
    const track = movie.subarray(box.payload, box.end);
    if (readTrackField(getChild(track, 'tkhd')) === trackId) return track;
  }
  throw new UnsupportedLayout('missing cam meta track');
}

function entryCount(table: Buffer, width: number): number {
  const count = table.readUInt32BE(4);
  requireLayout(table.readUInt32BE(0) === 0 && count > 0 && count <= MAX_SAMPLES);
  requireLayout(table.length === 8 + count * width);
  return count;
}

function sampleSizes(table: Buffer): number[] {
  const constant = table.readUInt32BE(4);
  const count = table.readUInt32BE(8);
  requireLayout(table.readUInt32BE(0) === 0 && count > 0 && count <= MAX_SAMPLES);
  requireLayout(table.length === 12 + (constant === 0 ? count * 4 : 0));
  return Array.from({ length: count }, (_, sample) => constant || table.readUInt32BE(12 + sample * 4));
}

function packetTimestamp(seconds: number): number {
  // ffprobe prints six decimal places and rounds exact halfway values to even.
  // After factoring out powers of five, binary halfway values are odd / 128.
  const ticksAt128Hz = seconds * 128;
  if (ticksAt128Hz % 4 === 1) {
    const micros = BigInt(ticksAt128Hz) * 15_625n / 2n;
    return Number(`${micros}e-6`);
  }
  return Number(seconds.toFixed(6));
}

function readPacketTimes(table: Buffer, sizes: number[], timescale: number) {
  const packets: CamMetaPacket[] = [];
  let ticks = 0;
  const count = entryCount(table, 8);
  const timeBase = 1 / timescale;
  for (let entry = 0; entry < count; entry++) {
    const offset = 8 + entry * 8;
    const samples = table.readUInt32BE(offset);
    const delta = table.readUInt32BE(offset + 4);
    requireLayout(samples > 0 && delta > 0 && packets.length + samples <= sizes.length);
    for (let sample = 0; sample < samples; sample++) {
      packets.push({ tSec: packetTimestamp(ticks * timeBase), size: sizes[packets.length] });
      ticks += delta;
    }
    requireLayout(Number.isSafeInteger(ticks));
  }
  requireLayout(packets.length === sizes.length);
  return { packets, ticks };
}

function validateEdit(
  track: Buffer, trackBoxes: Box[], movie: Buffer, movieBoxes: Box[],
  mediaScale: number, mediaTicks: number,
): void {
  if (!trackBoxes.some(({ type }) => type === 'edts')) return;
  const edit = getChild(getBox(track, trackBoxes, 'edts'), 'elst');
  const version = edit.readUInt8(0);
  requireLayout((version === 0 && edit.length === 20) || (version === 1 && edit.length === 28));
  const duration = version === 0 ? edit.readUInt32BE(8) : Number(edit.readBigUInt64BE(8));
  const start = version === 0 ? edit.readInt32BE(12) : Number(edit.readBigInt64BE(16));
  const movieScale = readTrackField(getBox(movie, movieBoxes, 'mvhd'));
  // A single edit covering the whole track at normal speed leaves PTS unchanged.
  requireLayout(edit.readUInt32BE(4) === 1 && start === 0 &&
    edit.readUInt32BE(edit.length - 4) === 0x00010000 &&
    movieScale > 0 && Number.isSafeInteger(duration) &&
    duration / movieScale >= mediaTicks / mediaScale);
}

function validateDataReference(mediaInfo: Buffer, descriptions: Buffer): void {
  requireLayout(descriptions.readUInt32BE(4) === 1);
  const [description] = childBoxes(descriptions.subarray(8));
  requireLayout(description && descriptions.readUInt16BE(8 + description.payload + 6) === 1);
  const references = getChild(getChild(mediaInfo, 'dinf'), 'dref');
  requireLayout(references.readUInt32BE(4) > 0);
  const [entry] = childBoxes(references.subarray(8));
  requireLayout(entry && entry.type === 'url ' && references.readUInt32BE(8 + entry.payload) === 1);
}

function readChunkLayout(table: Buffer, boxes: Box[], sizes: number[], mediaData: Box[]): Chunk[] {
  const wide = boxes.some(({ type }) => type === 'co64');
  requireLayout(!wide || !boxes.some(({ type }) => type === 'stco'));
  const offsets = getBox(table, boxes, wide ? 'co64' : 'stco');
  const width = wide ? 8 : 4;
  const chunkCount = entryCount(offsets, width);
  const mapping = getBox(table, boxes, 'stsc');
  const mapCount = entryCount(mapping, 12);
  const chunks: Chunk[] = [];
  let sample = 0;
  for (let row = 0; row < mapCount; row++) {
    const offset = 8 + row * 12;
    const first = mapping.readUInt32BE(offset);
    const end = row + 1 === mapCount ? chunkCount + 1 : mapping.readUInt32BE(offset + 12);
    const samples = mapping.readUInt32BE(offset + 4);
    requireLayout(first === chunks.length + 1 && end > first && end <= chunkCount + 1);
    requireLayout(samples > 0 && mapping.readUInt32BE(offset + 8) === 1);
    for (let chunk = first; chunk < end; chunk++) {
      const offsetIndex = 8 + (chunk - 1) * width;
      const position = wide ? Number(offsets.readBigUInt64BE(offsetIndex)) : offsets.readUInt32BE(offsetIndex);
      requireLayout(sample + samples <= sizes.length && Number.isSafeInteger(position));
      let size = 0;
      for (const limit = sample + samples; sample < limit; sample++) size += sizes[sample];
      requireLayout(mediaData.some(({ payload, end }) => position >= payload && size <= end - position));
      chunks.push({ offset: position, size });
    }
  }
  requireLayout(sample === sizes.length);
  return chunks;
}

async function readTrack(file: FileHandle, size: number, trackId: number): Promise<CamMetaTrack> {
  const top = await readTopLevel(file, size);
  const movies = top.filter(({ type }) => type === 'moov');
  requireLayout(movies.length === 1 && !top.some(({ type }) => type === 'moof'));
  const [{ payload, end }] = movies;
  requireLayout(end - payload <= MAX_BOX_BYTES);
  const movie = Buffer.alloc(end - payload);
  await readExactly(file, movie, payload);
  const movieBoxes = childBoxes(movie);
  requireLayout(!movieBoxes.some(({ type }) => type === 'mvex'));

  const track = findTrack(movie, movieBoxes, trackId);
  const trackBoxes = childBoxes(track);
  const media = getBox(track, trackBoxes, 'mdia');
  const timescale = readTrackField(getChild(media, 'mdhd'));
  const mediaInfo = getChild(media, 'minf');
  const table = getChild(mediaInfo, 'stbl');
  const boxes = childBoxes(table);
  requireLayout(timescale > 0 && !boxes.some(({ type }) => type === 'ctts' || type === 'stz2'));
  validateDataReference(mediaInfo, getBox(table, boxes, 'stsd'));

  const sizes = sampleSizes(getBox(table, boxes, 'stsz'));
  const bytes = sizes.reduce((total, sample) => total + sample, 0);
  requireLayout(bytes > 0 && bytes <= MAX_CAM_BYTES && sizes.every((size) => size > 0));
  const { packets, ticks } = readPacketTimes(getBox(table, boxes, 'stts'), sizes, timescale);
  validateEdit(track, trackBoxes, movie, movieBoxes, timescale, ticks);
  const chunks = readChunkLayout(table, boxes, sizes, top.filter(({ type }) => type === 'mdat'));
  const buffer = Buffer.alloc(bytes);
  let target = 0;
  for (const chunk of chunks) {
    await readExactly(file, buffer.subarray(target, target + chunk.size), chunk.offset);
    target += chunk.size;
  }
  return { buffer, packets };
}

export async function readCamMetaTrack(videoPath: string, trackId: number): Promise<CamMetaTrack | null> {
  try {
    const file = await open(videoPath, 'r');
    try {
      const { size } = await file.stat();
      return await readTrack(file, size, trackId);
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof UnsupportedLayout || error instanceof RangeError ||
      (error instanceof Error && 'code' in error)) return null;
    throw error;
  }
}
