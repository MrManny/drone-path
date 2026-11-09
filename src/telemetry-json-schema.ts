import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateTelemetryJsonSchema } from './telemetry-json.js';

export function writeTelemetryJsonSchema(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, generateTelemetryJsonSchema());
}

function main(): void {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const file = path.join(root, 'docs', 'telemetry-json.schema.json');
    writeTelemetryJsonSchema(file);
    process.stderr.write(`[drone-path] docs: wrote ${path.relative(root, file)}\n`);
  } catch (e) {
    process.stderr.write(`[drone-path] ERROR: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
