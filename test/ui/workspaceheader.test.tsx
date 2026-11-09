// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceHeader } from '../../ui/components/WorkspaceHeader.js';

afterEach(cleanup);

describe('WorkspaceHeader', () => {
  it('shows the wordmark and the project identity', () => {
    render(<WorkspaceHeader durationSec={3} />);
    expect(document.querySelector('.brand')?.textContent).toBe('drone / path');
    expect(screen.getByText('Flight workspace')).toBeTruthy();
    expect(screen.getByText('Recording · 0:03')).toBeTruthy();
  });

  it('carries no commands: the menu bar owns them', () => {
    render(<WorkspaceHeader durationSec={3} />);
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('carries no readiness text', () => {
    render(<WorkspaceHeader durationSec={3} />);
    expect(document.querySelector('.header-status')).toBeNull();
  });

  it('shows the zero-duration project slot', () => {
    render(<WorkspaceHeader durationSec={0} />);
    expect(screen.getByText('Recording · 0:00')).toBeTruthy();
  });
});
