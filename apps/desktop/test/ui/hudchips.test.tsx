// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as GeneratedCatalogs from '../../src/desktop-i18n/generated/catalogs.js';
import { resolveLocale } from '../../src/desktop-i18n/messages.js';
import { hudMarkup } from 'drone-path-engine/renderer/dom';
import { LanguageProvider } from '../../ui/lib/i18n.js';
import { HudChips } from '../../ui/components/HudChips.js';
import type { ChipReadouts } from '../../ui/lib/chipreadouts.js';

vi.mock('../../src/desktop-i18n/generated/catalogs.js', async (importOriginal) => {
  const { catalogs } = await importOriginal<typeof GeneratedCatalogs>();
  const prefixed = Object.fromEntries(Object.entries(catalogs.en).map(([key, value]) => [
    key, typeof value === 'string' ? `翻訳 ${value}` : value,
  ]));
  return {
    catalogs: {
      en: catalogs.en,
      ja: {
        ...prefixed,
        'chipreadouts.heading': '方位',
        'chipreadouts.altitude': '高度',
        'chipreadouts.speed': '速度',
        'chipreadouts.headingValue': '{name}、{value}°',
        'chipreadouts.altitudeValue': '{name}、{value} m',
        'chipreadouts.speedValue': '{name}、{value} m/s',
      },
    },
  };
});

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
    expect(heading.textContent).toContain('Heading');
    expect(alt.textContent).toBe('Altitude11m');
    expect(speed.textContent).toBe('Speed2.6m/s');
  });

  it.for([
    { pill: 'HDG', name: 'Heading, 90°' },
    { pill: 'ALT', name: 'Altitude, 11 m' },
    { pill: 'SPD', name: 'Speed, 2.6 m/s' },
  ])('abbreviates the $pill pill on-screen but names it in full (#283)', ({ pill, name }) => {
    render(
      <HudChips
        abbreviated
        hud={{ heading: true, alt: true, speed: true }}
        readouts={READOUTS}
        altUnavailable={false}
        onToggle={() => {}}
      />,
    );
    const chip = chips().find((b) => b.textContent?.includes(pill));
    expect(chip?.getAttribute('aria-label')).toBe(name);
  });

  it('mirrors the rendered HUD in the export preview and translates the desktop labels', () => {
    const hud = { heading: true, alt: true, speed: true };
    const rendered = document.createElement('div');
    rendered.innerHTML = hudMarkup(hud);
    const exportLabels = [...rendered.querySelectorAll('.label')].map((node) => node.textContent);
    const props = { hud, readouts: READOUTS, altUnavailable: false, onToggle: () => {} };
    const locale = resolveLocale(null, ['ja-JP']);
    const { container, rerender } = render(
      <LanguageProvider locale={locale}>
        <HudChips {...props} abbreviated />
      </LanguageProvider>,
    );
    const labels = () => [...container.querySelectorAll('.label')].map((node) => node.textContent);

    expect(labels()).toEqual(exportLabels);
    for (const name of ['方位、90°', '高度、11 m', '速度、2.6 m/s']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }

    rerender(
      <LanguageProvider locale={locale}>
        <HudChips {...props} />
      </LanguageProvider>,
    );
    expect(labels()).toEqual(['方位', '高度', '速度']);
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
