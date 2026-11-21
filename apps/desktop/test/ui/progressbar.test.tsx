// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProgressBar } from '../../ui/components/ProgressBar.js';

afterEach(cleanup);

describe('ProgressBar', () => {
  it('exposes its value to assistive technology and paints the fill', () => {
    render(<ProgressBar label="Preparation progress" percent={29} />);
    const bar = screen.getByRole('progressbar', { name: 'Preparation progress' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('29');
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('29%');
  });

  it('pins its classes to the shared progress vocabulary', () => {
    render(<ProgressBar label="Export progress" percent={0} />);
    const bar = screen.getByRole('progressbar', { name: 'Export progress' });
    expect(bar.className).toBe('progress-track');
    expect((bar.firstElementChild as HTMLElement).className).toBe('progress-fill');
  });

  describe('without a known level', () => {
    it('keeps the bar in the indeterminate shape', () => {
      render(<ProgressBar label="Export progress" percent={null} />);
      const bar = screen.getByRole('progressbar', { name: 'Export progress' });
      expect(bar.getAttribute('aria-valuenow')).toBeNull();
      expect(bar.getAttribute('aria-valuemin')).toBeNull();
      expect(bar.getAttribute('aria-valuemax')).toBeNull();
    });

    it('paints a shimmering fill instead of an empty track', () => {
      render(<ProgressBar label="Export progress" percent={null} />);
      const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement;
      expect(fill.className).toBe('progress-fill progress-shimmer');
      expect(fill.style.width).toBe('');
    });
  });
});
