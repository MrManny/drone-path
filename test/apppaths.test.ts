import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { appStateFile, uiExportRoot, userDataDir } from '../src/apppaths.js';

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

describe('userDataDir', () => {
  it('prefers LOCALAPPDATA', () => {
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\me\\AppData\\Local');
    expect(userDataDir()).toBe(path.join('C:\\Users\\me\\AppData\\Local', 'drone-path'));
  });

  it('falls back to the home cache directory', () => {
    const saved = process.env['LOCALAPPDATA'];
    delete process.env['LOCALAPPDATA'];
    try {
      expect(userDataDir()).toBe(path.join(os.homedir(), '.cache', 'drone-path'));
    } finally {
      if (saved !== undefined) process.env['LOCALAPPDATA'] = saved;
    }
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
