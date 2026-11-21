import { productMetaPacket } from './core.js';

function uints(...values: number[]): Buffer {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
  return bytes;
}

function box(type: string, ...children: Buffer[]): Buffer {
  const size = children.reduce((total, child) => total + child.length, 8);
  return Buffer.concat([uints(size), Buffer.from(type), ...children]);
}

const SOURCE_PACKETS = [
  productMetaPacket(46.6, 14.2),
  productMetaPacket(0, 0),
  productMetaPacket(46.61, 14.201, { relAltMm: 3100 }),
];

type Layout = 'ordinary' | 'wide' | 'fragmented' | 'bad-offset' | 'composition-offset' | 'identity-edit' | 'shifted-edit' | 'rounding-tie';

export function camMetaMp4(layout: Layout = 'ordinary') {
  const [first, second, third] = SOURCE_PACKETS;
  const fileType = box('ftyp', Buffer.from('isom'), uints(0), Buffer.from('isom'));
  const gap = Buffer.alloc(7, 0x42);
  const mediaData = box('mdat', first, second, gap, third);
  const start = fileType.length + 8;
  const chunkOffsets = [start, start + first.length + second.length + gap.length];
  if (layout === 'bad-offset') chunkOffsets[1] += third.length;

  const wide = layout === 'wide';
  const roundingTie = layout === 'rounding-tie';
  const offsets = chunkOffsets.flatMap((offset) => wide ? [0, offset] : [offset]);
  const description = box('gpmd', Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]));
  const table = box('stbl',
    box('stsd', uints(0, 1), description),
    box('stts', roundingTie ? uints(0, 2, 1, 1, 2, 2) : uints(0, 2, 2, 1001, 1, 1000)),
    box('stsc', uints(0, 2, 1, 2, 1, 2, 1, 1)),
    box('stsz', uints(0, 0, 3, first.length, second.length, third.length)),
    box(wide ? 'co64' : 'stco', uints(0, 2, ...offsets)),
    ...(layout === 'composition-offset' ? [box('ctts', uints(0, 1, 3, 12))] : []),
  );
  const dataInfo = box('dinf', box('dref', uints(0, 1), box('url ', uints(1))));
  const mediaInfo = box('minf', box('nmhd', uints(0)), dataInfo, table);
  const handler = box('hdlr', uints(0, 0), Buffer.from('meta'), uints(0, 0, 0), Buffer.from('CAM meta\0'));
  const media = box('mdia', box('mdhd', uints(0, 0, 0, roundingTie ? 128 : 30_000, roundingTie ? 5 : 3002, 0)), handler, mediaInfo);
  const trackHeader = box('tkhd', uints(7, 0, 0, 3, 0, 101, 0, 0, 0, 0,
    0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000, 0, 0));
  const edits = layout === 'identity-edit' || layout === 'shifted-edit'
    ? [box('edts', box('elst', uints(0, 1, 101, layout === 'identity-edit' ? 0 : 1, 0x10000)))]
    : [];
  const movieHeader = box('mvhd', uints(0, 0, 0, 1000, 101, 0x10000, 0x01000000, 0, 0,
    0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000, 0, 0, 0, 0, 0, 0, 4));
  const movie = box('moov', movieHeader, box('trak', trackHeader, ...edits, media));
  return {
    file: Buffer.concat([fileType, mediaData, movie, ...(layout === 'fragmented' ? [box('moof')] : [])]),
    buffer: Buffer.concat(SOURCE_PACKETS),
    packets: SOURCE_PACKETS.map((sample, i) => ({
      tSec: (roundingTie ? [0, 0.007812, 0.023438] : [0, 0.033367, 0.066733])[i],
      size: sample.length,
    })),
  };
}
