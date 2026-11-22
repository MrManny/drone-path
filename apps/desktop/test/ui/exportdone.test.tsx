// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExportDoneProps } from '../../ui/components/ExportDone.js';
import { ExportDone } from '../../ui/components/ExportDone.js';
import type { RecordingSummary } from 'drone-path-engine/pipeline';

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
  render(<ExportDone result={RESULT} error={null} {...overrides} />);
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

  it('drops the rate and duration clauses when the summary carries no rate', () => {
    renderDone({ result: { ...RESULT, fps: undefined } });
    expect(screen.getByText('120 frames · 1280×720')).toBeTruthy();
  });

  it('surfaces a reveal or open failure above the summary', () => {
    renderDone({ error: { code: 'BACKEND_ERROR', detail: 'the app backend went away' } });
    expect(screen.getByText('BACKEND_ERROR: the app backend went away')).toBeTruthy();
    expect(screen.getByText('120 frames @ 29.97 fps · 4 s · 1280×720')).toBeTruthy();
  });
});
