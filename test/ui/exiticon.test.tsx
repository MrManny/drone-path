// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExitIcon } from '../../ui/icons/ExitIcon.js';

afterEach(cleanup);

// The geometry assertions pin the app-drawn power glyph so it cannot silently
// drift from the approved menu mock-up.
describe('ExitIcon', () => {
  it('renders the power glyph in the app icon style', () => {
    const { container } = render(<ExitIcon />);
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
    expect(paths).toEqual(['M18.36 6.64a9 9 0 1 1-12.73 0', 'M12 2v10']);
  });
});
