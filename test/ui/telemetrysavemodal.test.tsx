// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TelemetrySaveModalProps } from '../../ui/components/TelemetrySaveModal.js';
import { TelemetrySaveModal } from '../../ui/components/TelemetrySaveModal.js';

afterEach(cleanup);

function renderModal(overrides: Partial<TelemetrySaveModalProps> = {}) {
  const onReveal = vi.fn();
  const onClose = vi.fn();
  render(
    <TelemetrySaveModal
      scope="In–Out segment (0:04–0:10 · 181 frames)"
      phase={{ kind: 'done', path: '/exports/flight.telemetry.json' }}
      {...overrides}
      onReveal={overrides.onReveal ?? onReveal}
      onClose={overrides.onClose ?? onClose}
    />,
  );
  return { onReveal, onClose };
}

// The phase's action row; the dialog header carries its own close control.
function actions(): HTMLElement {
  return document.querySelector('.dialog-actions') as HTMLElement;
}

describe('TelemetrySaveModal saving phase', () => {
  it('says the write is in flight and offers no action yet', () => {
    renderModal({ phase: { kind: 'saving' } });
    expect(screen.getByText('Saving telemetry JSON…')).toBeTruthy();
    expect(document.querySelector('.dialog-actions')).toBeNull();
  });

  it('names the dialog', () => {
    renderModal({ phase: { kind: 'saving' } });
    expect(screen.getByRole('dialog', { name: 'Save telemetry JSON' })).toBeTruthy();
  });
});

describe('TelemetrySaveModal done phase', () => {
  it('reports the kept file and the scope it covers', () => {
    renderModal();
    expect(screen.getByText('Telemetry JSON saved.')).toBeTruthy();
    expect(screen.getByText('/exports/flight.telemetry.json')).toBeTruthy();
    expect(screen.getByText('Scope: In–Out segment (0:04–0:10 · 181 frames)')).toBeTruthy();
  });

  it('offers Reveal in folder and Close', () => {
    const { onReveal, onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in folder' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    fireEvent.click(within(actions()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces a reveal failure above the done content', () => {
    renderModal({
      phase: {
        kind: 'done',
        path: '/exports/flight.telemetry.json',
        error: 'the app backend went away',
      },
    });
    expect(screen.getByText('the app backend went away')).toBeTruthy();
    expect(screen.getByText('Telemetry JSON saved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reveal in folder' })).toBeTruthy();
  });
});

describe('TelemetrySaveModal error phase', () => {
  it('reports the failure and offers only Close', () => {
    const { onClose } = renderModal({ phase: { kind: 'error', message: 'disk full' } });
    expect(screen.getByText('disk full')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reveal in folder' })).toBeNull();
    fireEvent.click(within(actions()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
