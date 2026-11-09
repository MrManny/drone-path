// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StatusBar } from '../../ui/components/StatusBar.js';

afterEach(cleanup);

describe('StatusBar', () => {
  it('reports that no recording is loaded', () => {
    render(<StatusBar disabled hasTelemetry={false} />);
    expect(screen.getByText('No recording loaded')).toBeTruthy();
  });

  it('reports loaded SRT telemetry', () => {
    render(<StatusBar hasTelemetry />);
    expect(screen.getByText('SRT telemetry loaded')).toBeTruthy();
  });

  it('stays quiet with a recording and no telemetry', () => {
    render(<StatusBar hasTelemetry={false} />);
    expect(document.querySelector('.status-item')).toBeNull();
  });

  it('carries no commands: the menu bar owns them', () => {
    render(<StatusBar hasTelemetry />);
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });
});
