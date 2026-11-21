import { numberValue, parseValue, strictShape } from './validation.js';

export interface FrameRange {
  start: number;
  end: number;
}

function assertValidFrameRange(range: FrameRange, name = 'frame range'): void {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new Error(`invalid ${name}: start and end must be integer frame indices`);
  }
  // A single-frame span (start === end) is a valid export range.
  if (range.start < 0 || range.start > range.end) {
    throw new Error(`invalid ${name}: expected 0 <= start <= end, got ${range.start}-${range.end}`);
  }
}

export function parseFrameRange(raw: unknown, name = 'frame range'): FrameRange {
  const range = parseValue(
    strictShape(
      {
        start: numberValue(`${name}: start`),
        end: numberValue(`${name}: end`),
      },
      {
        invalid: `invalid ${name}`,
        unknownKey: (key) => `unknown ${name} key ${key}`,
      },
    ),
    raw,
  );
  assertValidFrameRange(range, name);
  return range;
}

export function resolveFrameRange(
  range: FrameRange | null | undefined,
  frames: number,
): FrameRange | null {
  if (!range) return null;
  assertValidFrameRange(range);
  if (range.end >= frames) {
    throw new Error(
      `frame range ${range.start}-${range.end} is beyond the recording (${frames} frames)`,
    );
  }
  return range;
}
