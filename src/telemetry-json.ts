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

type TelemetryRecord = z.infer<typeof TelemetryRecordSchema>;
type TelemetryGimbalDevice = z.infer<typeof GimbalDeviceSchema>;
export type TelemetryDocument = z.infer<typeof TelemetryDocumentSchema>;

type TelemetryValueKey = Exclude<
  keyof TelemetryRecord,
  'frame' | 'headingDeg' | 'headingSource'
>;

export type TelemetryFrameInput = { [K in TelemetryValueKey]?: number | null };

export interface TelemetryDocumentInput {
  protoFile?: string | null;
  source: TelemetrySource;
  headingMode: HeadingMode;
  frameCount: number;
  frameStart?: number;
  gimbalDevice?: TelemetryGimbalDevice | null;
  frames: readonly TelemetryFrameInput[];
  headingDeg: readonly number[];
}

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
