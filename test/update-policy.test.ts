import { describe, expect, it } from 'vitest';

import { shouldCheckForUpdates } from '../app/update-policy.mjs';

describe.each([
  {
    when: 'a packaged build carries the update metadata (NSIS, AppImage)',
    packaged: true,
    hasUpdateMetadata: true,
    checks: true,
  },
  {
    when: 'a packaged build carries no update metadata (portable)',
    packaged: true,
    hasUpdateMetadata: false,
    checks: false,
  },
  {
    when: 'an unpackaged build carries the update metadata',
    packaged: false,
    hasUpdateMetadata: true,
    checks: false,
  },
  {
    when: 'an unpackaged build carries no update metadata',
    packaged: false,
    hasUpdateMetadata: false,
    checks: false,
  },
])('shouldCheckForUpdates: $when', ({ packaged, hasUpdateMetadata, checks }) => {
  it(checks ? 'talks to the update feed' : 'never talks to the update feed', () => {
    expect(shouldCheckForUpdates({ packaged, hasUpdateMetadata })).toBe(checks);
  });
});
