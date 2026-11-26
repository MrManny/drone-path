// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceHeader } from '../../ui/components/WorkspaceHeader.js';

afterEach(cleanup);

describe('WorkspaceHeader', () => {
  it('shows the wordmark and the project identity as an h1 (#411)', () => {
    render(<WorkspaceHeader durationSec={3} />);
    expect(document.querySelector('.brand')?.textContent).toBe('drone / path');
    expect(screen.getByRole('heading', { level: 1, name: 'Flight workspace' })).toBeTruthy();
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

  it('renders flush mode tabs when showModeSwitch is enabled', () => {
    render(
      <WorkspaceHeader
        durationSec={null}
        mode="archive"
        showModeSwitch
        onModeChange={vi.fn()}
      />,
    );
    const tablist = screen.getByRole('tablist', { name: 'Workspace mode' });
    expect(tablist.className).toBe('header-mode-tabs');
    const archiveTab = within(tablist).getByRole('tab', { name: 'Archive' });
    const reviewTab = within(tablist).getByRole('tab', { name: 'Review' });
    expect(archiveTab.getAttribute('aria-selected')).toBe('true');
    expect(reviewTab.getAttribute('aria-selected')).toBe('false');
    expect(archiveTab.getAttribute('tabindex')).toBe('0');
    expect(reviewTab.getAttribute('tabindex')).toBe('-1');
  });

  it('updates aria-selected for review mode and invokes onModeChange on click', () => {
    const onModeChange = vi.fn();
    render(
      <WorkspaceHeader
        durationSec={12}
        mode="review"
        showModeSwitch
        onModeChange={onModeChange}
      />,
    );
    const archiveTab = screen.getByRole('tab', { name: 'Archive' });
    const reviewTab = screen.getByRole('tab', { name: 'Review' });
    expect(archiveTab.getAttribute('aria-selected')).toBe('false');
    expect(reviewTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(archiveTab);
    expect(onModeChange).toHaveBeenCalledWith('archive');

    fireEvent.click(reviewTab);
    expect(onModeChange).toHaveBeenCalledWith('review');
  });

  it('moves focus and switches mode with horizontal arrow keys', () => {
    const onModeChange = vi.fn();
    render(
      <WorkspaceHeader
        durationSec={null}
        mode="archive"
        showModeSwitch
        onModeChange={onModeChange}
      />,
    );
    const archiveTab = screen.getByRole('tab', { name: 'Archive' });
    const reviewTab = screen.getByRole('tab', { name: 'Review' });

    archiveTab.focus();
    fireEvent.keyDown(archiveTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(reviewTab);
    expect(onModeChange).toHaveBeenCalledWith('review');

    fireEvent.keyDown(reviewTab, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(archiveTab);
    expect(onModeChange).toHaveBeenCalledTimes(1);
  });

  it('switches mode with Home and End keys and ignores modified presses', () => {
    const onModeChange = vi.fn();
    render(
      <WorkspaceHeader
        durationSec={null}
        mode="archive"
        showModeSwitch
        onModeChange={onModeChange}
      />,
    );
    const archiveTab = screen.getByRole('tab', { name: 'Archive' });
    const reviewTab = screen.getByRole('tab', { name: 'Review' });

    archiveTab.focus();
    fireEvent.keyDown(archiveTab, { key: 'End', shiftKey: true });
    expect(onModeChange).not.toHaveBeenCalled();

    fireEvent.keyDown(archiveTab, { key: 'End' });
    expect(document.activeElement).toBe(reviewTab);
    expect(onModeChange).toHaveBeenCalledWith('review');

    fireEvent.keyDown(reviewTab, { key: 'Home' });
    expect(document.activeElement).toBe(archiveTab);
    expect(onModeChange).toHaveBeenCalledTimes(1);
  });
});
