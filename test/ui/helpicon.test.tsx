// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HelpIcon } from '../../ui/icons/HelpIcon.js';

afterEach(cleanup);

// The geometry assertions pin the vendored Lucide path data, so an icon bump
// cannot silently drift from upstream.
describe('HelpIcon', () => {
  it('renders the vendored Lucide circle-help geometry', () => {
    const { container } = render(<HelpIcon />);
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
    const paths = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    expect(paths).toEqual([
      'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3',
      'M12 17h.01',
    ]);
    const circle = container.querySelector('circle');
    expect(
      [circle?.getAttribute('cx'), circle?.getAttribute('cy'), circle?.getAttribute('r')],
    ).toEqual(['12', '12', '10']);
  });
});
