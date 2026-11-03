// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WarmHint } from '../../ui/components/WarmHint.js';

afterEach(cleanup);

describe('WarmHint', () => {
  it('counts the plan while tiles keep streaming', () => {
    render(<WarmHint progress={{ done: 12, total: 48 }} />);
    const hint = screen.getByRole('status');
    expect(hint.textContent).toBe('Warming tiles… 12/48');
    expect(hint.className).toContain('warm-hint');
  });

  it('disappears when the last tile settles', () => {
    const { rerender } = render(<WarmHint progress={{ done: 47, total: 48 }} />);
    expect(screen.getByText('Warming tiles… 47/48')).toBeTruthy();
    rerender(<WarmHint progress={{ done: 48, total: 48 }} />);
    expect(screen.queryByText(/Warming tiles/)).toBeNull();
  });

  it('stays out of the way while nothing streams', () => {
    render(<WarmHint progress={{ done: 0, total: 0 }} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
