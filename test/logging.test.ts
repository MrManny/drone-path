import { describe, expectTypeOf, it } from 'vitest';

import type { LogFn } from '../src/logging.js';

describe('LogFn', () => {
  it('is a single-message sink', () => {
    expectTypeOf<LogFn>().toEqualTypeOf<(msg: string) => void>();
  });
});
