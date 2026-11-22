import { describe, expect, it } from 'vitest';

import {
  APP_ORIGIN,
  MEDIA_PATH,
  TILE_BASE,
  isAllowedAppUrl,
  mediaUrlFor,
  parseLoopbackDevUrl,
  resolveDevUrl,
} from '../src/appurls.js';

describe('protocol and URL constants', () => {
  it('derives tile and media URLs from APP_ORIGIN', () => {
    expect(APP_ORIGIN).toBe('app://bundle');
    expect(MEDIA_PATH).toBe('/media/video');
    expect(TILE_BASE).toBe('app://bundle/tiles');
    expect(mediaUrlFor('/clips/flight 1.mp4')).toBe(
      'app://bundle/media/video?v=%2Fclips%2Fflight%201.mp4',
    );
  });
});

describe('parseLoopbackDevUrl', () => {
  it.for([
    ['http://localhost:3210', 'http://localhost:3210/'],
    ['http://127.0.0.1:3210', 'http://127.0.0.1:3210/'],
    ['http://[::1]:3210', 'http://[::1]:3210/'],
    ['http://LOCALHOST:3210/preview', 'http://localhost:3210/preview'],
  ])('accepts loopback http URL %s', ([input, expected]) => {
    expect(parseLoopbackDevUrl(input)).toBe(expected);
  });

  it.for([
    'https://localhost:3210',
    'http://attacker.example',
    'http://localhost.attacker.example:3210',
    'http://127.0.0.2:3210',
    'http://user:pass@localhost:3210',
    'file:///C:/evil.html',
    'not-a-url',
    '',
  ])('rejects non-loopback or non-http URL %s', (input) => {
    expect(() => parseLoopbackDevUrl(input)).toThrow('invalid --dev-url');
  });
});

describe('resolveDevUrl', () => {
  it('ignores --dev-url in packaged builds', () => {
    expect(resolveDevUrl(['app.exe', '--dev-url', 'https://attacker.example'], true)).toBeNull();
    expect(resolveDevUrl(['app.exe', '--dev-url=http://localhost:3210'], true)).toBeNull();
    expect(resolveDevUrl(['app.exe', '--dev-url'], true)).toBeNull();
  });

  it('returns null when --dev-url is absent in unpackaged builds', () => {
    expect(resolveDevUrl(['node', 'main.mjs'], false)).toBeNull();
  });

  it('accepts a valid loopback URL in unpackaged builds', () => {
    expect(resolveDevUrl(['node', 'main.mjs', '--dev-url', 'http://localhost:3210'], false)).toBe(
      'http://localhost:3210/',
    );
    expect(resolveDevUrl(['node', 'main.mjs', '--dev-url=http://127.0.0.1:3210'], false)).toBe(
      'http://127.0.0.1:3210/',
    );
  });

  it('rejects missing, flag-like, or untrusted --dev-url values in unpackaged builds', () => {
    expect(() => resolveDevUrl(['node', 'main.mjs', '--dev-url'], false)).toThrow('missing URL');
    expect(() => resolveDevUrl(['node', 'main.mjs', '--dev-url', '--other'], false)).toThrow(
      'missing URL',
    );
    expect(() =>
      resolveDevUrl(['node', 'main.mjs', '--dev-url', 'https://attacker.example'], false),
    ).toThrow('invalid --dev-url');
    expect(() =>
      resolveDevUrl(['node', 'main.mjs', '--dev-url=https://attacker.example'], false),
    ).toThrow('invalid --dev-url');
  });
});

describe('isAllowedAppUrl', () => {
  it('allows app://bundle and rejects other origins in production mode', () => {
    expect(isAllowedAppUrl('app://bundle/', null)).toBe(true);
    expect(isAllowedAppUrl('app://bundle/index.html', null)).toBe(true);
    expect(isAllowedAppUrl('app://bundle.evil/index.html', null)).toBe(false);
    expect(isAllowedAppUrl('app://user@bundle/index.html', null)).toBe(false);
    expect(isAllowedAppUrl('http://localhost:3210/', null)).toBe(false);
    expect(isAllowedAppUrl('file:///C:/evil.html', null)).toBe(false);
    expect(isAllowedAppUrl('https://attacker.example/', null)).toBe(false);
    expect(isAllowedAppUrl('', null)).toBe(false);
  });

  it('allows the validated devUrl origin in dev mode and rejects untrusted origins', () => {
    expect(isAllowedAppUrl('http://localhost:3210/app', 'http://localhost:3210')).toBe(true);
    expect(isAllowedAppUrl('http://localhost:3210.evil/', 'http://localhost:3210')).toBe(false);
    expect(isAllowedAppUrl('http://user@localhost:3210/', 'http://localhost:3210')).toBe(false);
    expect(isAllowedAppUrl('http://localhost:9999/', 'http://localhost:3210')).toBe(false);
    expect(isAllowedAppUrl('https://attacker.example/', 'https://attacker.example')).toBe(false);
  });
});
