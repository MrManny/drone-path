import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateTelemetryJsonSchema } from '../src/telemetry-json.js';
import { writeTelemetryJsonSchema } from '../src/telemetry-json-schema.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('writeTelemetryJsonSchema', () => {
  it('writes the generator output to the given file', () => {
    const file = path.join(tmpDir(), 'nested', 'telemetry-json.schema.json');
    writeTelemetryJsonSchema(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(generateTelemetryJsonSchema());
  });
});
