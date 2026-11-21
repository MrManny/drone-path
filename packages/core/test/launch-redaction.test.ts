import { expect, it } from 'vitest';

import { launchRedactor } from '../src/launch-redaction.js';

const fix = (lon: number, lat = 0) => ({ lat, lon });

it('drops protected fixes, keeps gaps, and never bridges a return to the protected area', () => {
  const privatePoint = fix(0);
  const east = fix(0.02);
  const west = fix(-0.02);
  const segments = [[privatePoint, east, fix(0.03), privatePoint, west], [fix(5), fix(6)]];
  expect(launchRedactor([privatePoint], 100)(segments)).toEqual([
    [east, fix(0.03)], [west], [fix(5), fix(6)],
  ]);
  expect(launchRedactor([privatePoint], 0)(segments)).toEqual(segments);
});

it.each([
  { name: 'a crossing', center: fix(0), points: [fix(-0.02), fix(0.02)] },
  { name: 'a tangent', center: fix(0), points: [fix(-0.02, 0.000899), fix(0.02, 0.000899)] },
  { name: 'an antimeridian crossing', center: fix(180), points: [fix(179.98), fix(-179.98)] },
])('breaks $name even when both endpoints are outside', ({ center, points }) => {
  expect(launchRedactor([center], 100)([points])).toEqual(points.map((point) => [point]));
});

it('drops a track contained entirely in the protected area', () => {
  expect(launchRedactor([fix(0)], 100)([[fix(0), fix(0.0003)]])).toEqual([]);
});
