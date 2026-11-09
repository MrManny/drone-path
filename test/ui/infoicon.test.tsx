// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { InfoIcon } from '../../ui/icons/InfoIcon.js';

afterEach(cleanup);

describe('InfoIcon', () => {
  it('draws in the shared line style and stays hidden from assistive technology', () => {
    const { container } = render(<InfoIcon />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const circle = container.querySelector('circle');
    expect([circle?.getAttribute('cx'), circle?.getAttribute('cy'), circle?.getAttribute('r')]).toEqual(
      ['12', '12', '9'],
    );
    const paths = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    expect(paths).toEqual(['M12 11v5', 'M12 8h.01']);
  });
});
