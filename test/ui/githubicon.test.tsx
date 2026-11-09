// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GitHubIcon } from '../../ui/icons/GitHubIcon.js';

afterEach(cleanup);

// The geometry assertion pins the octocat mark, so it cannot silently drift.
describe('GitHubIcon', () => {
  it('renders the GitHub mark as a filled glyph hidden from assistive technology', () => {
    const { container } = render(<GitHubIcon />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const paths = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    expect(paths).toEqual([expect.stringMatching(/^M12 \.297c-6\.63 0-12 5\.373-12 12/)]);
    expect(paths[0]).toContain('12-12');
  });
});
