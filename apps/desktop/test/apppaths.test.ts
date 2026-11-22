import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { appStateFile, uiExportRoot } from '../src/apppaths.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('uiExportRoot', () => {
  it('resolves ui/out as a sibling of the app shell directory', () => {
    expect(uiExportRoot(path.join('repo', 'app'))).toBe(path.join('repo', 'ui', 'out'));
    expect(uiExportRoot(path.join('C:', 'src', 'app'))).toBe(path.join('C:', 'src', 'ui', 'out'));
  });

  it('works from inside app.asar', () => {
    expect(uiExportRoot(path.join('resources', 'app.asar', 'app'))).toBe(
      path.join('resources', 'app.asar', 'ui', 'out'),
    );
  });
});

describe('appStateFile', () => {
  it('is state.json in the per-user app directory', () => {
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\me\\AppData\\Local');
    expect(appStateFile()).toBe(
      path.join('C:\\Users\\me\\AppData\\Local', 'drone-path', 'state.json'),
    );
  });
});
