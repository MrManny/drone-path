import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { generateTelemetryJsonSchema } from 'drone-path-core/telemetry-json';
import { writeTelemetryJsonSchema } from '../src/telemetry-json-schema.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

afterEach(cleanupTmpDirs);

describe('writeTelemetryJsonSchema', () => {
  it('writes the generator output to the given file', () => {
    const file = path.join(tmpDir(), 'nested', 'telemetry-json.schema.json');
    writeTelemetryJsonSchema(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(generateTelemetryJsonSchema());
  });
});

describe('docs/telemetry-json.schema.json', () => {
  it('matches the generator; run "npm run docs:schema" after changing the core schema', () => {
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
