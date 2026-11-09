// The per-frame telemetry JSON export ("--telemetry-json"): the document's
// field vocabulary in one home - a zod schema that types the emitter via
// z.infer and generates the checked-in docs/telemetry-json.schema.json via
// z.toJSONSchema ("npm run docs:schema"). Pure so the CLI and the desktop app
// can write the identical document; I/O lives in the shells.

import { z } from 'zod';

import type { HeadingMode, TelemetrySource } from './telemetry-math.js';

export const TELEMETRY_JSON_SCHEMA_VERSION = 1;

const GimbalDeviceSchema = z.strictObject({
  id: z.int(),
  type: z.int(),
  subType: z.int(),
  name: z.string(),
  frequency: z.number(),
});

// Record fields in the acceptance order: time, position, body attitude,
// camera attitude, heading, camera exposure. Optional fields are absent keys,
// never null.
const TelemetryRecordSchema = z.strictObject({
  frame: z.int(),
  gimbalDeviceTimestampMs: z.int().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  altAbs: z.number().optional(),
  altRel: z.number().optional(),
  gpsAltMm: z.int().optional(),
  pitchDeg: z.number().optional(),
  rollDeg: z.number().optional(),
  yawDeg: z.number().optional(),
  gimbalPitchDeg: z.number().optional(),
  gimbalRollDeg: z.number().optional(),
  gimbalYawDeg: z.number().optional(),
  headingDeg: z.number(),
  headingSource: z.enum(['yaw', 'cog']),
  iso: z.int().optional(),
  shutterTime: z.number().optional(),
  whiteBalanceCctK: z.int().optional(),
  fNumber: z.number().optional(),
});

export const TelemetryDocumentSchema = z.strictObject({
  schemaVersion: z.literal(TELEMETRY_JSON_SCHEMA_VERSION),
  protoFile: z.string().optional(),
  source: z.enum(['srt', 'cammeta']),
  headingMode: z.enum(['yaw', 'cog']),
  frameCount: z.int(),
  gimbalDevice: GimbalDeviceSchema.optional(),
  frames: z.array(TelemetryRecordSchema),
});

export type TelemetryRecord = z.infer<typeof TelemetryRecordSchema>;
export type TelemetryGimbalDevice = z.infer<typeof GimbalDeviceSchema>;
export type TelemetryDocument = z.infer<typeof TelemetryDocumentSchema>;

export type TelemetryValueKey = Exclude<
  keyof TelemetryRecord,
  'frame' | 'headingDeg' | 'headingSource'
>;

/** One source frame's decoded values, decoder-shaped (null = not carried). */
export type TelemetryFrameInput = { [K in TelemetryValueKey]?: number | null };

export interface TelemetryDocumentInput {
  /** "proto_file_name product_proto_version" as the stream declares it. */
  protoFile?: string | null;
  source: TelemetrySource;
  headingMode: HeadingMode;
  frameCount: number;
  /** Source frame index of row 0 (default 0): segment documents keep the
   * recording's frame numbers, so records read frameStart + row index. */
  frameStart?: number;
  gimbalDevice?: TelemetryGimbalDevice | null;
  /** Per-source-frame values; fewer entries than frameCount is fine. */
  frames: readonly TelemetryFrameInput[];
  /** The pipeline's per-frame heading - the values the map arrow renders. */
  headingDeg: readonly number[];
}

// The record's key order: the acceptance grouping above, fixed so reruns are
// byte-identical.
const BEFORE_HEADING_KEYS = [
  'gimbalDeviceTimestampMs',
  'lat',
  'lng',
  'altAbs',
  'altRel',
  'gpsAltMm',
  'pitchDeg',
  'rollDeg',
  'yawDeg',
  'gimbalPitchDeg',
  'gimbalRollDeg',
  'gimbalYawDeg',
] as const satisfies readonly TelemetryValueKey[];

const EXPOSURE_KEYS = [
  'iso',
  'shutterTime',
  'whiteBalanceCctK',
  'fNumber',
] as const satisfies readonly TelemetryValueKey[];

// The schema declares these values as integers (their DVTM wire encoding is
// a varint); fractional input (e.g. a decimal SRT cue) rounds to the nearest
// integer so the emitted document always validates against the schema.
const INTEGER_VALUE_KEYS: ReadonlySet<TelemetryValueKey> = new Set([
  'gimbalDeviceTimestampMs',
  'gpsAltMm',
  'iso',
  'whiteBalanceCctK',
]);

function copyValue(
  record: Record<string, number | string | undefined>,
  key: TelemetryValueKey,
  value: number | null | undefined,
): void {
  if (value === null || value === undefined) return;
  record[key] = INTEGER_VALUE_KEYS.has(key) ? Math.round(value) : value;
}

// One record per source frame: row i's decoded values plus the pipeline's
// heading for that frame. Frames without source values carry frame + heading
// only - unknown values are omitted, never guessed.
function buildRecord(
  input: TelemetryDocumentInput,
  index: number,
): TelemetryRecord {
  const row = input.frames[index] ?? {};
  const record: Record<string, number | string | undefined> = {
    frame: (input.frameStart ?? 0) + index,
  };
  for (const key of BEFORE_HEADING_KEYS) copyValue(record, key, row[key]);
  record.headingDeg = input.headingDeg[index];
  record.headingSource = input.headingMode;
  for (const key of EXPOSURE_KEYS) copyValue(record, key, row[key]);
  return record as TelemetryRecord;
}

export function buildTelemetryDocument(
  input: TelemetryDocumentInput,
): TelemetryDocument {
  if (input.headingDeg.length !== input.frameCount) {
    throw new Error('telemetry JSON: heading count does not match the frame count');
  }
  const frames: TelemetryRecord[] = [];
  for (let index = 0; index < input.frameCount; index++) {
    frames.push(buildRecord(input, index));
  }
  return {
    schemaVersion: TELEMETRY_JSON_SCHEMA_VERSION,
    ...(input.protoFile ? { protoFile: input.protoFile } : {}),
    source: input.source,
    headingMode: input.headingMode,
    frameCount: input.frameCount,
    ...(input.gimbalDevice ? { gimbalDevice: input.gimbalDevice } : {}),
    frames,
  };
}

export function serializeTelemetryDocument(doc: TelemetryDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function generateTelemetryJsonSchema(): string {
  return `${JSON.stringify(z.toJSONSchema(TelemetryDocumentSchema), null, 2)}\n`;
}
