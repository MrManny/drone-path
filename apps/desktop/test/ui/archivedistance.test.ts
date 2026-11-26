import { describe, expect, it } from 'vitest';

import { tEnglish } from '../../shared/desktop-i18n/loader.js';
import { formatArchiveDistance } from '../../ui/lib/archivedistance.js';

describe('formatArchiveDistance', () => {
  it('returns -- for missing or non-finite values', () => {
    expect(formatArchiveDistance(null, tEnglish)).toBe('--');
    expect(formatArchiveDistance(undefined, tEnglish)).toBe('--');
    expect(formatArchiveDistance(Number.NaN, tEnglish)).toBe('--');
    expect(formatArchiveDistance(Infinity, tEnglish)).toBe('--');
  });

  it('formats distances under 1000 meters in rounded meters', () => {
    expect(formatArchiveDistance(0, tEnglish)).toBe('0 m');
    expect(formatArchiveDistance(14.6, tEnglish)).toBe('15 m');
    expect(formatArchiveDistance(999.4, tEnglish)).toBe('999 m');
  });

  it('formats distances of 1000 meters or more in kilometers', () => {
    expect(formatArchiveDistance(1000, tEnglish)).toBe('1.0 km');
    expect(formatArchiveDistance(1540, tEnglish)).toBe('1.5 km');
  });
});
