// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HudChips } from '../../ui/components/HudChips.js';
import type { ChipReadouts } from '../../ui/lib/chipreadouts.js';

const READOUTS: ChipReadouts = { headingDeg: 90, alt: 11.4, speed: 2.56 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function chips(): HTMLButtonElement[] {
  return [...screen.getByRole('group', { name: 'On-frame readouts' }).querySelectorAll('button')];
}

describe('HudChips', () => {
  it('renders the chips with their values and units', () => {
    render(
      <HudChips
        hud={{ heading: true, alt: true, speed: true }}
        readouts={READOUTS}
        altUnavailable={false}
        onToggle={() => {}}
      />,
    );
    const [heading, alt, speed] = chips();
    expect(heading.textContent).toContain('HDG');
    expect(alt.textContent).toBe('ALT11m');
    expect(speed.textContent).toBe('SPD2.6m/s');
  });

  it.for([
    { pill: 'HDG', name: 'Heading, 90°' },
    { pill: 'ALT', name: 'Altitude, 11 m' },
    { pill: 'SPD', name: 'Speed, 2.6 m/s' },
  ])('abbreviates the $pill pill on-screen but names it in full (#283)', ({ pill, name }) => {
    render(
      <HudChips
        hud={{ heading: true, alt: true, speed: true }}
        readouts={READOUTS}
        altUnavailable={false}
        onToggle={() => {}}
      />,
    );
    const chip = chips().find((b) => b.textContent?.includes(pill));
    expect(chip?.getAttribute('aria-label')).toBe(name);
  });

  it('drops the value from the aria-label when a chip is off (#283)', () => {
    render(
      <HudChips
        hud={{ heading: false, alt: false, speed: false }}
        readouts={READOUTS}
        altUnavailable={false}
        onToggle={() => {}}
      />,
    );
    for (const name of ['Heading', 'Altitude', 'Speed']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('turns the chip into a toggle that reports the chip id', () => {
    const onToggle = vi.fn();
    render(
      <HudChips
        hud={{ heading: true, alt: false, speed: true }}
        readouts={READOUTS}
        altUnavailable={false}
        onToggle={onToggle}
      />,
    );
    const [, alt] = chips();
    expect(alt.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(alt);
    expect(onToggle).toHaveBeenCalledWith('alt');
  });

  it('shows the dimmed placeholder for a chip that is off', () => {
    render(
      <HudChips
        hud={{ heading: false, alt: false, speed: false }}
        readouts={READOUTS}
        altUnavailable={false}
        onToggle={() => {}}
      />,
    );
    for (const chip of chips()) {
      expect(chip.getAttribute('aria-pressed')).toBe('false');
      expect(chip.textContent).toContain('--');
    }
  });

  it('disables the ALT chip when the telemetry has no altitude', () => {
    const onToggle = vi.fn();
    render(
      <HudChips
        hud={{ heading: true, alt: true, speed: true }}
        readouts={READOUTS}
        altUnavailable
        onToggle={onToggle}
      />,
    );
    const [, alt] = chips();
    expect(alt.disabled).toBe(true);
    expect(alt.textContent).toContain('--');
    fireEvent.click(alt);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('names the heading degrees for screen readers and keeps the arrow decorative', () => {
    render(
      <HudChips
        hud={{ heading: true, alt: false, speed: false }}
        readouts={READOUTS}
        altUnavailable={false}
        onToggle={() => {}}
      />,
    );
    const heading = screen.getByRole('button', { name: 'Heading, 90°' });
    const arrow = heading.querySelector('.chip-arrow') as HTMLElement;
    expect(arrow.getAttribute('aria-hidden')).toBe('true');
    expect(arrow.style.transform).toBe('rotate(90deg)');
  });

  it('keeps the placeholder readout in the heading chip name while it is off', () => {
    render(
      <HudChips
        hud={{ heading: false, alt: false, speed: false }}
        readouts={READOUTS}
        altUnavailable={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Heading/ }).textContent).toContain('--');
  });
});
