import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateCliReference } from './cliref.js';

function writeReference(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, generateCliReference());
}

function main(): void {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const file = path.join(root, 'docs', 'user', 'cli-reference.md');
    writeReference(file);
    process.stderr.write(`[drone-path] manual: wrote ${path.relative(root, file)}\n`);
  } catch (e) {
    process.stderr.write(`[drone-path] ERROR: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
