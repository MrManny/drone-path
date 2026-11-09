import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  TELEMETRY_JSON_SCHEMA_VERSION,
  TelemetryDocumentSchema,
  buildTelemetryDocument,
  generateTelemetryJsonSchema,
  serializeTelemetryDocument,
} from '../src/telemetry-json.js';
import type {
  TelemetryDocumentInput,
  TelemetryFrameInput,
} from '../src/telemetry-json.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fullRow(overrides: TelemetryFrameInput = {}): TelemetryFrameInput {
  return {
    gimbalDeviceTimestampMs: 1234,
    lat: 46.61307,
    lng: 14.262388,
    altAbs: 313.227,
    altRel: 3.3,
    gpsAltMm: 313227,
    pitchDeg: -3.2,
    rollDeg: 0.4,
    yawDeg: 121.7,
    gimbalPitchDeg: -12.2,
    gimbalRollDeg: 0,
    gimbalYawDeg: 108.5,
    iso: 340,
    shutterTime: 0.0025,
    whiteBalanceCctK: 4435,
    fNumber: 2.2,
    ...overrides,
  };
}

function docInput(overrides: Partial<TelemetryDocumentInput> = {}): TelemetryDocumentInput {
  return {
    protoFile: 'dvtm_NEO2.proto v02.00.07',
    source: 'cammeta',
    headingMode: 'yaw',
    frameCount: 3,
    gimbalDevice: { id: 0, type: 1, subType: 3, name: 'gimbal', frequency: 200 },
    frames: [fullRow(), fullRow(), fullRow()],
    headingDeg: [90, 90.5, 91],
    ...overrides,
  };
}

describe('buildTelemetryDocument', () => {
  it('emits the versioned header and one record per source frame', () => {
    const doc = buildTelemetryDocument(docInput());
    expect(doc.schemaVersion).toBe(TELEMETRY_JSON_SCHEMA_VERSION);
    expect(doc.protoFile).toBe('dvtm_NEO2.proto v02.00.07');
    expect(doc.source).toBe('cammeta');
    expect(doc.headingMode).toBe('yaw');
    expect(doc.frameCount).toBe(3);
    expect(doc.gimbalDevice).toEqual({
      id: 0,
      type: 1,
      subType: 3,
      name: 'gimbal',
      frequency: 200,
    });
    expect(doc.frames.map((f) => f.frame)).toEqual([0, 1, 2]);
  });

  it('carries every decoded field with the pipeline heading on top', () => {
    const record = buildTelemetryDocument(docInput()).frames[0];
    expect(record).toEqual({
      frame: 0,
      gimbalDeviceTimestampMs: 1234,
      lat: 46.61307,
      lng: 14.262388,
      altAbs: 313.227,
      altRel: 3.3,
      gpsAltMm: 313227,
      pitchDeg: -3.2,
      rollDeg: 0.4,
      yawDeg: 121.7,
      gimbalPitchDeg: -12.2,
      gimbalRollDeg: 0,
      gimbalYawDeg: 108.5,
      headingDeg: 90,
      headingSource: 'yaw',
      iso: 340,
      shutterTime: 0.0025,
      whiteBalanceCctK: 4435,
      fNumber: 2.2,
    });
  });

  it('fixes the record key order so reruns are byte-identical', () => {
    const record = buildTelemetryDocument(docInput()).frames[0];
    expect(Object.keys(record)).toEqual([
      'frame',
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
      'headingDeg',
      'headingSource',
      'iso',
      'shutterTime',
      'whiteBalanceCctK',
      'fNumber',
    ]);
  });

  it('omits unknown values as absent keys and keeps known zeros', () => {
    const record = buildTelemetryDocument(
      docInput({ frames: [{ lat: 46.6, lng: 14.2, gimbalRollDeg: 0, altRel: 0 }] }),
    ).frames[0];
    expect(record).not.toHaveProperty('gpsAltMm');
    expect(record).not.toHaveProperty('gimbalPitchDeg');
    expect(record).not.toHaveProperty('shutterTime');
    expect(record).not.toHaveProperty('iso');
    expect(record.gimbalRollDeg).toBe(0);
    expect(record.altRel).toBe(0);
  });

  it('omits position keys when the frame has no GPS fix', () => {
    const record = buildTelemetryDocument(
      docInput({ frames: [{ altRel: 3.4 }, {}, {}] }),
    ).frames[0];
    expect(record).not.toHaveProperty('lat');
    expect(record).not.toHaveProperty('lng');
    expect(record.altRel).toBe(3.4);
  });

  it('keeps heading-only records for frames without source values', () => {
    const doc = buildTelemetryDocument(docInput({ frames: [fullRow()] }));
    expect(doc.frames[1]).toEqual({ frame: 1, headingDeg: 90.5, headingSource: 'yaw' });
    expect(doc.frames[2]).toEqual({ frame: 2, headingDeg: 91, headingSource: 'yaw' });
  });

  it('drops source values beyond the frame count', () => {
    const doc = buildTelemetryDocument(
      docInput({
        frameCount: 2,
        frames: [fullRow(), fullRow(), fullRow()],
        headingDeg: [90, 90.5],
      }),
    );
    expect(doc.frames).toHaveLength(2);
  });

  it('labels every record with the heading source the pipeline used', () => {
    const doc = buildTelemetryDocument(
      docInput({ source: 'srt', headingMode: 'cog', frames: [{}, {}, {}] }),
    );
    expect(doc.frames.map((f) => f.headingSource)).toEqual(['cog', 'cog', 'cog']);
  });

  it('exports the empty document for zero-frame input', () => {
    const doc = buildTelemetryDocument(
      docInput({ frameCount: 0, frames: [], headingDeg: [] }),
    );
    expect(doc.frameCount).toBe(0);
    expect(doc.frames).toEqual([]);
  });

  it('omits provenance the source does not carry', () => {
    const doc = buildTelemetryDocument(
      docInput({ source: 'srt', protoFile: null, gimbalDevice: null }),
    );
    expect(doc).not.toHaveProperty('protoFile');
    expect(doc).not.toHaveProperty('gimbalDevice');
  });

  it('rejects a heading count that does not match the frame count', () => {
    expect(() =>
      buildTelemetryDocument(docInput({ headingDeg: [90] })),
    ).toThrow(/heading count does not match/);
  });

  it('is deterministic across builds and serializations', () => {
    const one = serializeTelemetryDocument(buildTelemetryDocument(docInput()));
    const two = serializeTelemetryDocument(buildTelemetryDocument(docInput()));
    expect(two).toBe(one);
  });

  it('never serializes a null value', () => {
    const doc = buildTelemetryDocument(
      docInput({ frames: [{ lat: null, iso: undefined, altRel: 0 }, {}, {}] }),
    );
    expect(serializeTelemetryDocument(doc)).not.toContain('null');
  });
});

describe('TelemetryDocumentSchema', () => {
  it('accepts the built document', () => {
    const doc = buildTelemetryDocument(docInput());
    expect(TelemetryDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects unknown keys (strict objects)', () => {
    const doc = buildTelemetryDocument(docInput()) as Record<string, unknown>;
    expect(
      TelemetryDocumentSchema.safeParse({ ...doc, surprise: 1 }).success,
    ).toBe(false);
  });

  it('rejects explicit nulls - absent keys, never null', () => {
    const record = { frame: 0, headingDeg: 90, headingSource: 'yaw', lat: null };
    expect(TelemetryDocumentSchema.shape.frames.element.safeParse(record).success).toBe(
      false,
    );
  });

  it('rejects a wrong schema version', () => {
    const doc = buildTelemetryDocument(docInput()) as Record<string, unknown>;
    expect(
      TelemetryDocumentSchema.safeParse({ ...doc, schemaVersion: 2 }).success,
    ).toBe(false);
  });
});

describe('generateTelemetryJsonSchema', () => {
  it('is deterministic and marks optional fields absent, not null', () => {
    const schema = generateTelemetryJsonSchema();
    expect(generateTelemetryJsonSchema()).toBe(schema);
    const parsed = JSON.parse(schema) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(parsed.required).toEqual([
      'schemaVersion',
      'source',
      'headingMode',
      'frameCount',
      'frames',
    ]);
    expect(Object.keys(parsed.properties)).toContain('gimbalDevice');
    expect(schema).not.toContain('"null"');
  });
});

// The checked-in JSON Schema is generated ("npm run docs:schema"), never
// hand-edited - same gate as the CLI reference.
describe('docs/telemetry-json.schema.json', () => {
  it('matches the generator; run "npm run docs:schema" after changing src/telemetry-json.ts', () => {
    const checkedIn = fs.readFileSync(
      path.join(root, 'docs', 'telemetry-json.schema.json'),
      'utf8',
    );
    expect(
      checkedIn,
      'docs/telemetry-json.schema.json is stale; run "npm run docs:schema" and commit the result',
    ).toBe(generateTelemetryJsonSchema());
  });
});
