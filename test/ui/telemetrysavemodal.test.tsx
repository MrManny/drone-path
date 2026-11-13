// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TelemetrySaveModalProps } from '../../ui/components/TelemetrySaveModal.js';
import { TelemetrySaveModal } from '../../ui/components/TelemetrySaveModal.js';

afterEach(cleanup);

const DONE = {
  kind: 'done' as const,
  path: '/exports/flight.telemetry.json',
  scope: 'In–Out segment (0:04–0:10 · 181 frames)',
};

function renderModal(overrides: Partial<TelemetrySaveModalProps> = {}) {
  const onReveal = vi.fn();
  const onClose = vi.fn();
  render(
    <TelemetrySaveModal
      phase={DONE}
      dismissible
      {...overrides}
      onReveal={overrides.onReveal ?? onReveal}
      onClose={overrides.onClose ?? onClose}
    />,
  );
  return { onReveal, onClose };
}

function actions(): HTMLElement | null {
  return document.querySelector('.dialog-actions');
}

describe('TelemetrySaveModal saving phase', () => {
  it('says the write is in flight in the status line and offers no action yet', () => {
    renderModal({ phase: { kind: 'saving' } });
    const status = document.querySelector('.phase-status') as HTMLElement;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('Exporting telemetry…');
    expect(actions()).toBeNull();
  });

  it('names the dialog', () => {
    renderModal({ phase: { kind: 'saving' } });
    expect(screen.getByRole('dialog', { name: 'Export telemetry' })).toBeTruthy();
  });

  it('refuses every dismissal while the machine pins the write', () => {
    const { onClose } = renderModal({ phase: { kind: 'saving' }, dismissible: false });
    const headerClose = screen.getByRole<HTMLButtonElement>('button', { name: 'Close' });
    expect(headerClose.disabled).toBe(true);
    expect(headerClose.title).toBe('Exporting telemetry. Wait for it to finish.');
    fireEvent.click(document.querySelector('.settings-overlay') as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TelemetrySaveModal done phase', () => {
  it('reports the kept file and the scope captured at save time', () => {
    renderModal();
    expect(screen.getByText('Telemetry exported.')).toBeTruthy();
    expect(screen.getByText('/exports/flight.telemetry.json')).toBeTruthy();
    expect(screen.getByText('Scope: In–Out segment (0:04–0:10 · 181 frames)')).toBeTruthy();
  });

  it('keeps the file name visible and carries the full path as its tooltip', () => {
    renderModal();
    const out = screen.getByText('/exports/flight.telemetry.json');
    expect(out.getAttribute('title')).toBe('/exports/flight.telemetry.json');
  });

  it('offers Reveal in folder as the sole accent primary and no footer dismissal', () => {
    const { onReveal } = renderModal();
    const footer = actions() as HTMLElement;
    const reveal = within(footer).getByRole('button', { name: 'Reveal in folder' });
    expect(reveal.className).toBe('dialog-primary');
    expect([...footer.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Reveal in folder',
    ]);
    fireEvent.click(reveal);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('keeps exactly one dismissal control, the header ✕', () => {
    renderModal();
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });

  it('surfaces a reveal failure above the done content', () => {
    renderModal({
      phase: { ...DONE, error: 'the app backend went away' },
    });
    expect(screen.getByText('the app backend went away')).toBeTruthy();
    expect(screen.getByText('Telemetry exported.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reveal in folder' })).toBeTruthy();
  });

  it('moves focus to Reveal in folder when the write finishes', () => {
    const { rerender } = render(
      <TelemetrySaveModal phase={{ kind: 'saving' }} dismissible={false} onReveal={vi.fn()} onClose={vi.fn()} />,
    );
    rerender(<TelemetrySaveModal phase={DONE} dismissible onReveal={vi.fn()} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reveal in folder' }));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('TelemetrySaveModal error phase', () => {
  it('reports the failure and offers no footer', () => {
    renderModal({ phase: { kind: 'error', message: 'disk full' } });
    expect(screen.getByText('disk full')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reveal in folder' })).toBeNull();
    expect(actions()).toBeNull();
  });

  it('keeps exactly one dismissal control, the header ✕', () => {
    renderModal({ phase: { kind: 'error', message: 'disk full' } });
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });

  it('drops focus to the dialog, never to <body>', () => {
    const { rerender } = render(
      <TelemetrySaveModal phase={{ kind: 'saving' }} dismissible={false} onReveal={vi.fn()} onClose={vi.fn()} />,
    );
    rerender(
      <TelemetrySaveModal
        phase={{ kind: 'error', message: 'disk full' }}
        dismissible
        onReveal={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole('dialog', { name: 'Export telemetry' }),
    );
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('TelemetrySaveModal status region', () => {
  it('keeps one status region across the phase change', () => {
    const { rerender } = render(
      <TelemetrySaveModal phase={{ kind: 'saving' }} dismissible={false} onReveal={vi.fn()} onClose={vi.fn()} />,
    );
    const status = document.querySelector('.phase-status') as HTMLElement;
    rerender(<TelemetrySaveModal phase={DONE} dismissible onReveal={vi.fn()} onClose={vi.fn()} />);
    expect(document.querySelector('.phase-status')).toBe(status);
    expect(status.textContent).toBe('Telemetry exported.');
  });
});
