import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer/', import.meta.url));
const files = fs.readdirSync(RENDERER_DIR).filter((f) => f.endsWith('.ts'));

describe('renderer module graph', () => {
  it('has modules to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.for(files)('%s keeps runtime imports inside renderer/', (file) => {
    const text = fs.readFileSync(path.join(RENDERER_DIR, file), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^import (?!type\b).* from '([^']+)';$/.exec(line.trim());
      if (!m) continue;
      const spec = m[1];
      expect(spec, `${file} runtime import leaves renderer/`).toMatch(/^\.\//);
      const target = path.join(RENDERER_DIR, spec.replace(/\.js$/, '.ts'));
      expect(fs.existsSync(target), `${file} imports a missing ${spec}`).toBe(true);
    }
  });
});
