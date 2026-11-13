// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExportDoneProps } from '../../ui/components/ExportDone.js';
import { ExportDone } from '../../ui/components/ExportDone.js';
import type { RecordingSummary } from '../../src/pipeline.js';

afterEach(cleanup);

const RESULT: RecordingSummary = {
  video: '/recordings/flight.mp4',
  out: '/exports/flight-map.mp4',
  status: 'ok',
  elapsedSec: 4,
  frames: 120,
  fps: '30000/1001',
  width: 1280,
  height: 720,
};

function renderDone(overrides: Partial<ExportDoneProps> = {}) {
  const onReveal = overrides.onReveal ?? vi.fn();
  const onOpen = overrides.onOpen ?? vi.fn();
  render(
    <ExportDone result={RESULT} error={null} {...overrides} onReveal={onReveal} onOpen={onOpen} />,
  );
  return { onReveal, onOpen };
}

describe('ExportDone outcome', () => {
  it('reports the summary and the kept render path', () => {
    renderDone();
    expect(screen.getByText('120 frames @ 29.97 fps · 4 s · 1280×720')).toBeTruthy();
    expect(screen.getByText('/exports/flight-map.mp4')).toBeTruthy();
  });

  it('keeps the file name visible and carries the full path as its tooltip', () => {
    renderDone();
    const out = screen.getByText('/exports/flight-map.mp4');
    expect(out.className).toBe('export-path');
    expect(out.getAttribute('title')).toBe('/exports/flight-map.mp4');
  });

  it('drops the rate clause when the summary carries no rate', () => {
    renderDone({ result: { ...RESULT, fps: undefined } });
    expect(screen.getByText('120 frames · 4 s · 1280×720')).toBeTruthy();
  });

  it('surfaces a reveal or open failure above the summary', () => {
    renderDone({ error: 'the app backend went away' });
    expect(screen.getByText('the app backend went away')).toBeTruthy();
    expect(screen.getByText('120 frames @ 29.97 fps · 4 s · 1280×720')).toBeTruthy();
  });
});

describe('ExportDone actions', () => {
  it('offers Reveal in folder and Open video', () => {
    const { onReveal, onOpen } = renderDone();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in folder' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open video' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('makes Reveal in folder the one accent primary', () => {
    renderDone();
    expect(screen.getByRole('button', { name: 'Reveal in folder' }).className).toBe('dialog-primary');
    expect(screen.getByRole('button', { name: 'Open video' }).className).toBe('');
  });

  it('carries no footer dismissal; the header ✕ closes the dialog', () => {
    renderDone();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
