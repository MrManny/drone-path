import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The preload bridge and the ipc handlers name the same channels as plain
// strings with no shared constant, so a rename on one side can drift from the
// other without breaking any unit test. This cross-check pins both sides.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = fs.readFileSync(path.join(root, 'app', 'preload.cjs'), 'utf8');
const ipc = fs.readFileSync(path.join(root, 'app', 'ipc.mjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'app', 'main.mjs'), 'utf8');

function channels(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]).sort();
}

const invokes = (): string[] => channels(preload, /ipcRenderer\.invoke\('([^']+)'/g);
const handles = (): string[] => channels(ipc, /handle(?:Query)?\(devUrl, '([^']+)'/g);
const subscribes = (): string[] => channels(preload, /subscribe\('([^']+)'/g);
const sends = (): string[] =>
  [...new Set(channels(`${main}\n${ipc}`, /sendToWindow\(state, '([^']+)'/g))].sort();

describe('the preload and ipc channel lists', () => {
  it('match one to one across the invoke/handle wire', () => {
    expect(invokes()).toEqual(handles());
  });

  it('match one to one across the push/subscribe wire', () => {
    expect(subscribes()).toEqual(sends());
  });

  it('carry the track save flow on the track channels', () => {
    expect(invokes()).toContain('dronepath:track:pick-output');
    expect(invokes()).toContain('dronepath:track:save');
    expect(handles()).toContain('dronepath:track:pick-output');
    expect(handles()).toContain('dronepath:track:save');
  });
});
