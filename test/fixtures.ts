import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CONFIG } from '../src/config.js';
import type { RenderConfig } from '../src/config.js';
import type { VideoProbe } from '../src/ffmpeg.js';
import { videoBaseName } from '../src/recordings.js';
import type { PipelineDeps } from '../src/pipeline.js';
import type { Telemetry } from '../src/telemetry-math.js';
import type { RecordingTelemetry } from '../src/telemetry.js';
import type { TelemetryDocumentInput, TelemetryFrameInput } from '../src/telemetry-json.js';
import type { TrackRecord } from '../src/track.js';
import type { TrackExportInput } from '../src/track-write.js';

const tmpDirs: string[] = [];

export function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dronepath-test-'));
  tmpDirs.push(dir);
  return dir;
}

export function cleanupTmpDirs(): void {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const SRT_SAMPLE = `1
00:00:00,000 --> 00:00:00,033
<font size="28">FrameCnt: 1, DiffTime: 33ms
2026-05-25 09:18:11.708
[iso: 340] [shutter: 1/400.0] [fnum: 2.2] [ev: 0] [ct: 4435] [latitude: 46.613070] [longitude: 14.262388] [rel_alt: 3.300 abs_alt: 313.227] [eis: normal]</font>

2
00:00:00,033 --> 00:00:00,066
<font size="28">FrameCnt: 2, DiffTime: 33ms
2026-05-25 09:18:11.741
[iso: 340] [latitude: 0.000000] [longitude: 0.000000] [rel_alt: 3.400 abs_alt: 313.327]</font>

3
00:00:00,066 --> 00:00:00,100
<font size="28">FrameCnt: 3, DiffTime: 34ms
2026-05-25 09:18:11.775
[iso: 340] [latitude: 46.613071] [longitude: 14.262389] [rel_alt: 3.500 abs_alt: 313.427]</font>
`;

export const SRT_SAMPLE_MIXED = `1
00:00:00,000 --> 00:00:00,033
<font size="28">FrameCnt: 1, DiffTime: 33ms
2026-05-25 09:18:11.708
[iso: 340] [latitude: 46.613070] [longitude: 14.262388] [rel_alt: 3.300 abs_alt: 313.227]</font>

2
00:00:00,033 --> 00:00:00,066
<font size="28">FrameCnt: 2, DiffTime: 33ms
2026-05-25 09:18:11.741
[iso: 340] [latitude: 0.000000] [longitude: 0.000000] [rel_alt: 3.400 abs_alt: 313.327]</font>

3
00:00:00,066 --> 00:00:00,100
<font size="28">FrameCnt: 3, DiffTime: 34ms
2026-05-25 09:18:11.775
[iso: 340] [rel_alt: 3.500 abs_alt: 313.427]</font>

4
00:00:00,100 --> 00:00:00,133
<font size="28">FrameCnt: 4, DiffTime: 33ms
2026-05-25 09:18:11.808
[iso: 340] [latitude: 46.613072] [longitude: 14.262390] [rel_alt: 3.600 abs_alt: 313.527]</font>
`;

export function probeFixture(overrides: Partial<VideoProbe> = {}): VideoProbe {
  return {
    fps: { num: 30, den: 1, value: 30, str: '30' },
    frames: 3,
    durationSec: 0.1,
    width: 1280,
    height: 720,
    ...overrides,
  };
}

export function telemetryFixture(overrides: Partial<Telemetry> = {}): Telemetry {
  return {
    source: 'srt',
    method: 'srt-cues',
    headingMode: 'cog',
    sampleCount: 5,
    fixCount: 3,
    noLock: 2,
    frames: [
      { fix: { lat: 46.6, lon: 14.2 }, alt: 3.3, speed: 1.2, headingDeg: 90 },
      { fix: { lat: 46.61, lon: 14.21 }, alt: 3.4, speed: 1.3, headingDeg: 91 },
      { fix: { lat: 46.62, lon: 14.22 }, alt: 3.5, speed: 1.4, headingDeg: 92 },
    ],
    bbox: { minLat: 46.6, maxLat: 46.62, minLon: 14.2, maxLon: 14.22 },
    trackDistanceM: 42,
    ...overrides,
  };
}

export function statsTelemetry(overrides: Partial<Telemetry> = {}): Telemetry {
  return {
    source: 'cammeta',
    method: 'dvtm-packets',
    headingMode: 'yaw',
    sampleCount: 600,
    fixCount: 590,
    noLock: 4,
    frames: [],
    bbox: { minLat: 46.6, maxLat: 46.612, minLon: 14.26, maxLon: 14.262 },
    trackDistanceM: 567.4,
    ...overrides,
  };
}

export function loadedTelemetry(
  overrides: Partial<RecordingTelemetry> = {},
): RecordingTelemetry {
  return {
    telemetry: telemetryFixture(),
    frameValues: [],
    trackValues: [],
    protoFile: null,
    gimbalDevice: null,
    ...overrides,
  };
}

type StubDepsOptions = Partial<PipelineDeps> & {
  probe?: VideoProbe;
  telemetry?: Telemetry;
  loaded?: RecordingTelemetry;
};

export function stubDeps(options: StubDepsOptions = {}): PipelineDeps {
  const {
    probe = probeFixture(),
    telemetry = telemetryFixture(),
    loaded = loadedTelemetry({ telemetry }),
    ...overrides
  } = options;
  return {
    probeVideo: async () => probe,
    loadTelemetry: async () => loaded,
    prefetchTiles: async () => ({ downloaded: 2, failed: 1, total: 5 }),
    renderVideo: async () => ({ profile: { evalMs: 10, captureMs: 20, emitMs: 30 } }),
    verifyOutput: async () => ({ frames: probe.frames, fps: probe.fps.str, ok: true }),
    outputMatchesSource: async () => false,
    ...overrides,
  };
}

export function testConfig(overrides: Partial<RenderConfig> = {}): RenderConfig {
  return {
    ...DEFAULT_CONFIG,
    outDir: tmpDir(),
    tileCache: tmpDir(),
    ...overrides,
  };
}

export function writeSrt(videoPath: string, text: string): string {
  const srtPath = path.join(path.dirname(videoPath), `${videoBaseName(videoPath)}.srt`);
  fs.writeFileSync(srtPath, text);
  return srtPath;
}

// Track serializer fixtures: two segments (the no-fix row 2 breaks the line),
// one vertex fed by gpsAltMm and one without any altitude.
export const TRACK_ROWS: TelemetryFrameInput[] = [
  { lat: 46.61307, lng: 14.262388, altAbs: 313.227 },
  { lat: 46.613071, lng: 14.262389, altAbs: 313.427 },
  { lat: null, lng: null },
  { lat: 46.613072, lng: 14.26239, gpsAltMm: 313527 },
  { lat: 46.613073, lng: 14.262391 },
];

export function trackDocumentFixture(
  rows: readonly TelemetryFrameInput[] = TRACK_ROWS,
): TelemetryDocumentInput {
  return {
    source: 'srt',
    headingMode: 'cog',
    frameCount: rows.length,
    frames: rows,
    headingDeg: rows.map((_, index) => 90 + index),
  };
}

const TRACK_FPS = 30;

function trackRecordsFixture(
  rows: readonly TelemetryFrameInput[] = TRACK_ROWS,
  fpsValue = TRACK_FPS,
): TrackRecord[] {
  return rows.map((row, index) => ({ ...row, tSec: index / fpsValue }));
}

export function trackExportFixture(
  rows: readonly TelemetryFrameInput[] = TRACK_ROWS,
  fpsValue = TRACK_FPS,
): TrackExportInput {
  return {
    document: trackDocumentFixture(rows),
    track: {
      records: trackRecordsFixture(rows, fpsValue),
      fpsValue,
      frameCount: rows.length,
    },
  };
}

export const TRACK_GPX_GOLDEN = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="drone-path" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="46.61307" lon="14.262388">
        <ele>313.227</ele>
      </trkpt>
      <trkpt lat="46.613071" lon="14.262389">
        <ele>313.427</ele>
      </trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="46.613072" lon="14.26239">
        <ele>313.527</ele>
      </trkpt>
      <trkpt lat="46.613073" lon="14.262391"/>
    </trkseg>
  </trk>
</gpx>
`;

export const TRACK_GEOJSON_GOLDEN = `{
  "type": "Feature",
  "geometry": {
    "type": "MultiLineString",
    "coordinates": [
      [[14.262388, 46.61307, 313.227], [14.262389, 46.613071, 313.427]],
      [[14.26239, 46.613072, 313.527], [14.262391, 46.613073]]
    ]
  },
  "properties": {}
}
`;

export const TRACK_KML_GOLDEN = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <Placemark>
      <LineString>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>14.262388,46.61307,313.227 14.262389,46.613071,313.427</coordinates>
      </LineString>
    </Placemark>
    <Placemark>
      <LineString>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>14.26239,46.613072,313.527 14.262391,46.613073,0</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
`;

// Filled from kmzBytes(serializeKml(buildTrack(TRACK_ROWS))) once, then
// locked: these bytes may never change again for this input (a change is byte
// drift).
export const TRACK_KMZ_GOLDEN_HEX =
  '504b030414000000000000002100beb90bd9420200004202000007000000646f632e6b6d6c' +
  '3c3f786d6c2076657273696f6e3d22312e302220656e636f64696e673d225554462d38223f3e0a' +
  '3c6b6d6c20786d6c6e733d22687474703a2f2f7777772e6f70656e6769732e6e65742f6b6d6c2f322e3222' +
  '20786d6c6e733a67783d22687474703a2f2f7777772e676f6f676c652e636f6d2f6b6d6c2f6578742f322e32223e0a' +
  '20203c446f63756d656e743e0a' +
  '202020203c506c6163656d61726b3e0a' +
  '2020202020203c4c696e65537472696e673e0a' +
  '20202020202020203c616c7469747564654d6f64653e6162736f6c7574653c2f616c7469747564654d6f64653e0a' +
  '20202020202020203c636f6f7264696e617465733e31342e3236323338382c34362e36313330372c3331332e323237' +
  '2031342e3236323338392c34362e3631333037312c3331332e3432373c2f636f6f7264696e617465733e0a' +
  '2020202020203c2f4c696e65537472696e673e0a' +
  '202020203c2f506c6163656d61726b3e0a' +
  '202020203c506c6163656d61726b3e0a' +
  '2020202020203c4c696e65537472696e673e0a' +
  '20202020202020203c616c7469747564654d6f64653e636c616d70546f47726f756e643c2f616c7469747564654d6f64653e0a' +
  '20202020202020203c636f6f7264696e617465733e31342e32363233392c34362e3631333037322c3331332e353237' +
  '2031342e3236323339312c34362e3631333037332c303c2f636f6f7264696e617465733e0a' +
  '2020202020203c2f4c696e65537472696e673e0a' +
  '202020203c2f506c6163656d61726b3e0a' +
  '20203c2f446f63756d656e743e0a' +
  '3c2f6b6d6c3e0a' +
  '504b0102140014000000000000002100beb90bd94202000042020000070000000000000000000000000000000000' +
  '646f632e6b6d6c' +
  '504b0506000000000100010035000000670200000000';

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v > 0) b |= 0x80;
    bytes.push(b);
  } while (v > 0);
  return Buffer.from(bytes);
}

function fldDouble(num: number, value: number): Buffer {
  const body = Buffer.alloc(8);
  body.writeDoubleLE(value);
  return Buffer.concat([varint((num << 3) | 1), body]);
}

function fldBytes(num: number, payload: Buffer): Buffer {
  return Buffer.concat([varint((num << 3) | 2), varint(payload.length), payload]);
}

function fldFloat(num: number, value: number): Buffer {
  const body = Buffer.alloc(4);
  body.writeFloatLE(value);
  return Buffer.concat([varint((num << 3) | 5), body]);
}

function fldVarint(num: number, value: number): Buffer {
  return Buffer.concat([varint(num << 3), varint(value)]);
}

function fldString(num: number, value: string): Buffer {
  return fldBytes(num, Buffer.from(value, 'utf8'));
}

/** Euler angles in deci-degrees: the wire stores tenths, the decoder divides by 10. */
interface PacketEuler {
  pitch?: number;
  roll?: number;
  yaw?: number;
}

export interface PacketMeta {
  relAltMm?: number;
  absAltM?: number;
  gpsAltMm?: number;
  iso?: number;
  whiteBalanceCctK?: number;
  attitude?: PacketEuler;
  gimbal?: PacketEuler & {
    device?: {
      id: number;
      type: number;
      subType: number;
      name: string;
      frequency: number;
      timestampMs?: number;
    };
  };
  clip?: { protoFile: string; productProtoVersion: string };
}

function eulerMessage(spec: PacketEuler): Buffer {
  const parts: Buffer[] = [];
  if (spec.pitch !== undefined) parts.push(fldVarint(1, spec.pitch));
  if (spec.roll !== undefined) parts.push(fldVarint(2, spec.roll));
  if (spec.yaw !== undefined) parts.push(fldVarint(3, spec.yaw));
  return Buffer.concat(parts);
}

// CAM meta packet with a position pair at minimum (field map per
// src/cammeta-decode.ts): ProductMeta { 3 frame_meta { 4 drone { 4 GpsBasic
// { 1 PositionCoord { 2 lat, 3 lon } } } } }; meta adds the optional fields.
export function productMetaPacket(
  lat: number,
  lon: number,
  meta: PacketMeta = {},
): Buffer {
  const coord = Buffer.concat([fldDouble(2, lat), fldDouble(3, lon)]);
  const gpsParts = [fldBytes(1, coord)];
  if (meta.gpsAltMm !== undefined) gpsParts.push(fldVarint(2, meta.gpsAltMm));
  const gps = fldBytes(4, Buffer.concat(gpsParts));

  const droneParts: Buffer[] = [];
  if (meta.attitude) droneParts.push(fldBytes(3, eulerMessage(meta.attitude)));
  droneParts.push(gps);
  if (meta.relAltMm !== undefined) {
    droneParts.push(fldBytes(5, fldFloat(1, meta.relAltMm)));
  }

  const camParts: Buffer[] = [];
  if (meta.iso !== undefined) camParts.push(fldBytes(3, fldVarint(1, meta.iso)));
  if (meta.whiteBalanceCctK !== undefined) {
    camParts.push(fldBytes(6, fldVarint(1, meta.whiteBalanceCctK)));
  }
  if (meta.absAltM !== undefined) camParts.push(fldBytes(11, fldFloat(1, meta.absAltM)));

  const frameParts: Buffer[] = [];
  if (camParts.length > 0) frameParts.push(fldBytes(2, Buffer.concat(camParts)));
  frameParts.push(fldBytes(4, Buffer.concat(droneParts)));
  if (meta.gimbal) {
    const gimbalParts: Buffer[] = [];
    const device = meta.gimbal.device;
    if (device) {
      gimbalParts.push(
        fldBytes(
          1,
          Buffer.concat([
            fldVarint(1, device.id),
            fldVarint(2, device.type),
            fldVarint(3, device.subType),
            fldString(4, device.name),
            fldFloat(5, device.frequency),
            fldVarint(6, device.timestampMs ?? 0),
          ]),
        ),
      );
    }
    gimbalParts.push(fldBytes(2, eulerMessage(meta.gimbal)));
    frameParts.push(fldBytes(5, Buffer.concat(gimbalParts)));
  }

  const parts: Buffer[] = [];
  if (meta.clip) {
    parts.push(
      fldBytes(
        1,
        fldBytes(
          1,
          Buffer.concat([
            fldString(1, meta.clip.protoFile),
            fldString(3, meta.clip.productProtoVersion),
          ]),
        ),
      ),
    );
  }
  parts.push(fldBytes(3, Buffer.concat(frameParts)));
  return Buffer.concat(parts);
}
