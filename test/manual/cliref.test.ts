import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONFIG_OPTIONS } from '../../src/config.js';
import { generateCliReference } from '../../src/manual/cliref.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('generateCliReference', () => {
  const text = generateCliReference();

  it.for(CONFIG_OPTIONS.map((row) => row.key))('covers the %s option', (key) => {
    expect(text).toContain(`| \`${key}\` |`);
  });

  it('covers the config-file flag outside the vocabulary', () => {
    expect(text).toContain('`--config <path>`');
  });

  it('covers the deprecated --telemetry-json alias and its status', () => {
    expect(text).toContain('| `telemetryJson` | `--telemetry-json <file>` | — |');
    expect(text).toContain('deprecated alias of --track-out &lt;file&gt;.json');
  });

  it('escapes angle brackets so GitHub renders the help text', () => {
    expect(text).toContain('&lt;basename&gt;');
  });

  it('marks empty defaults and boolean defaults', () => {
    expect(text).toContain('| `browser` | `--browser <path>` | — |');
    expect(text).toContain('| `quiet` | `-q, --quiet` | off |');
  });

  it('lists enum choices', () => {
    expect(text).toContain('(choices: satellite, topo)');
    expect(text).toContain('(choices: jpeg, png)');
  });

  it('is deterministic', () => {
    expect(generateCliReference()).toBe(text);
  });
});

describe('the checked-in CLI reference', () => {
  it('matches the generator; run "npm run docs:reference" after changing src/config.ts', () => {
    const checkedIn = fs.readFileSync(path.join(root, 'docs', 'user', 'cli-reference.md'), 'utf8');
    expect(
      checkedIn,
      'docs/user/cli-reference.md is stale; run "npm run docs:reference" and commit the result',
    ).toBe(generateCliReference());
  });
});
