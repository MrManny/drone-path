// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConfigOverrides } from '../../src/config.js';
import { OpeningEndingStrip } from '../../ui/components/OpeningEndingStrip.js';
import type { PreviewSegment } from '../../ui/components/OpeningEndingStrip.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderStrip(
  over: Partial<{
    introSec: number;
    outroSec: number;
    selected: PreviewSegment;
    onChange: (patch: ConfigOverrides) => boolean;
    onSelect: (segment: PreviewSegment) => void;
  }> = {},
) {
  return render(
    <OpeningEndingStrip
      introSec={over.introSec ?? 2}
      outroSec={over.outroSec ?? 2}
      flightSec={138}
      selected={over.selected ?? 'flight'}
      onSelect={over.onSelect ?? (() => {})}
      onChange={over.onChange ?? (() => true)}
    />,
  );
}

function segments(): HTMLButtonElement[] {
  return [...screen.getByRole('group', { name: 'Flight structure' }).querySelectorAll('button')];
}

describe('OpeningEndingStrip', () => {
  it('carries the visible Intro & outro heading of the fourth group', () => {
    renderStrip();
    const heading = screen.getByText('Intro & outro');
    expect(heading.tagName).toBe('LEGEND');
  });

  it('names the three phases with the flight length', () => {
    renderStrip();
    expect(segments().map((s) => s.textContent)).toEqual(['intro', 'flight 2:18', 'outro']);
  });

  it('says when the eases will shorten to fit the clip', () => {
    renderStrip({ introSec: 40, outroSec: 40 });
    expect(screen.getByText('Intro and outro shorten to fit this clip.')).toBeTruthy();
  });

  it('stays quiet while the eases fit the clip', () => {
    renderStrip({ introSec: 2, outroSec: 2 });
    expect(screen.queryByText('Intro and outro shorten to fit this clip.')).toBeNull();
  });

  it('sizes the segments after their durations', () => {
    renderStrip({ introSec: 4, outroSec: 1 });
    const [intro, flight, outro] = segments();
    expect(intro.style.flexGrow).toBe('4');
    expect(flight.style.flexGrow).toBe('138');
    expect(outro.style.flexGrow).toBe('1');
  });

  it('keeps a zero-second segment visible and clickable', () => {
    renderStrip({ introSec: 0, outroSec: 0 });
    const [intro, , outro] = segments();
    expect(Number(intro.style.flexGrow)).toBeGreaterThan(0);
    expect(Number(outro.style.flexGrow)).toBeGreaterThan(0);
  });

  it('selects the preview frame through the segments', () => {
    const onSelect = vi.fn();
    renderStrip({ selected: 'flight', onSelect });
    fireEvent.click(segments()[0]);
    expect(onSelect).toHaveBeenCalledWith('intro');
    fireEvent.click(segments()[2]);
    expect(onSelect).toHaveBeenCalledWith('outro');
    expect(segments()[1].getAttribute('aria-pressed')).toBe('true');
    expect(segments()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('sets the ease length through the steppers, with the shared hint', () => {
    const onChange = vi.fn(() => true);
    renderStrip({ onChange });
    expect(
      screen.getByText('the camera eases in and out · 0 s disables it'),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Intro length'), { target: { value: '1.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ introSec: 1.5 });
    fireEvent.change(screen.getByLabelText('Outro length'), { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith({ outroSec: 0 });
    expect(screen.getAllByText('s')).toHaveLength(2);
  });

  it('refuses a negative ease length with its rule', () => {
    const onChange = vi.fn(() => true);
    renderStrip({ onChange });
    fireEvent.change(screen.getByLabelText('Intro length'), { target: { value: '-1' } });
    expect(screen.getByText('Must be at least 0.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
