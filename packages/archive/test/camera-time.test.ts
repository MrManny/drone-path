import { expect, it } from 'vitest';

import { parseDateBound, zonedTimeMs } from '../src/camera-time.js';

it('interprets dates at midnight UTC and tags using their explicit offsets', () => {
  const epoch = Date.UTC(2025, 1, 2);
  expect(parseDateBound('2025-02-02')).toBe(epoch);
  expect(zonedTimeMs('2025-02-02T06:00:00+06:00')).toBe(epoch);
});

it.each(['2025-02-30', '2025-02-30T00:00:00Z', '2025-02-02T00:00', '02/02/2025'])(
  'rejects ambiguous or invalid date bound %s',
  (value) => expect(() => parseDateBound(value)).toThrow('expected an ISO date'),
);
