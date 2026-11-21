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

  it.for([
    { name: 'a zero duration', durationSec: 0, line: 'Recording · 0:00' },
    { name: 'a loaded recording', durationSec: 3, line: 'Recording · 0:03' },
  ])('shows the recording line with $name', ({ durationSec, line }) => {
    render(<WorkspaceHeader durationSec={durationSec} />);
    expect(screen.getByText(line)).toBeTruthy();
  });

  it('hides the recording line while no recording is loaded', () => {
    render(<WorkspaceHeader durationSec={null} />);
    expect(screen.queryByText(/Recording/)).toBeNull();
  });
});
