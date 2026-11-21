import { describe, expect, it } from 'vitest';

import { swatchIdFor } from '../../ui/lib/trailcolor.js';

describe('swatchIdFor', () => {
  it.for([
    { value: null, want: 'style-default' },
    { value: '#e87f54', want: 'coral' },
    { value: '#E87F54', want: 'coral' },
    { value: '#ffffff', want: 'white' },
    { value: '#000000', want: 'black' },
    { value: '#41f0ff', want: 'custom' },
    { value: '#e63946cc', want: 'custom' },
  ])('maps $value to the $want swatch', ({ value, want }) => {
    expect(swatchIdFor(value)).toBe(want);
  });
});
