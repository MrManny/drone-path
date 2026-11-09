// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { EmptyStage } from '../../ui/components/EmptyStage.js';
import { START_PREPARE_PROGRESS } from '../../ui/lib/pickstate.js';
import type { PickState } from '../../ui/lib/pickstate.js';

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { createFakeScene, immediateMapIslandMock } = await import('./harness.js');
  return immediateMapIslandMock(createFakeScene());
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let stylesheet: HTMLStyleElement;

beforeAll(() => {
  stylesheet = document.createElement('style');
  stylesheet.textContent = fs.readFileSync(path.join(root, 'ui', 'app', 'globals.css'), 'utf8');
  document.head.append(stylesheet);
});

afterAll(() => {
  stylesheet.remove();
});

afterEach(cleanup);

function renderStage(state: PickState = { kind: 'idle' }) {
  const onPick = vi.fn();
  const onDismiss = vi.fn();
  render(<EmptyStage state={state} onPick={onPick} onDismiss={onDismiss} />);
  return { onPick, onDismiss };
}

describe('EmptyStage', () => {
  it('reuses the player stage geometry', () => {
    renderStage();
    const stage = document.querySelector('.stage') as HTMLElement;
    expect(stage.className).toBe('stage stage-split');
    expect(stage.querySelector('.pane-video')).toBeTruthy();
    expect(stage.querySelector('.map-card')?.className).toBe('map-card map-card-split');
  });

  it('offers the open call to action with the explainer and the hint', () => {
    renderStage();
    expect(screen.getByRole('button', { name: 'Open…' })).toBeTruthy();
    expect(
      screen.getByText(/Pick a drone recording to watch its flight path on the map in sync with/),
    ).toBeTruthy();
    expect(screen.getByText(/SRT sidecar/)).toBeTruthy();
  });

  it('wears the accent on the stage CTA alone', () => {
    renderStage();
    const primaries = document.querySelectorAll('button.primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toContain('Open…');
    expect(primaries[0].closest('.pane-video')).not.toBeNull();
  });

  it('centers a wide primary button over the quiet copy', () => {
    renderStage();
    const block = document.querySelector('.stage-empty') as HTMLElement;
    expect(getComputedStyle(block).display).toBe('flex');
    expect(getComputedStyle(block).justifyContent).toBe('center');
    const open = screen.getByRole('button', { name: 'Open…' });
    expect(getComputedStyle(open).width).toBe('320px');
    expect(getComputedStyle(open).maxWidth).toBe('100%');
  });

  it('reads the quiet map placeholder without mounting the map island', () => {
    renderStage();
    expect(screen.getByText('No telemetry yet')).toBeTruthy();
    expect(screen.queryByTestId('map-island')).toBeNull();
  });

  it('invokes onPick on click', async () => {
    const { onPick } = renderStage();
    await userEvent.click(screen.getByRole('button', { name: 'Open…' }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('keeps the call to action quiet while the native picker is open', () => {
    renderStage({ kind: 'picking' });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' });
    expect(button.disabled).toBe(false);
    expect(screen.queryByText(/Preparing/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('goes disabled Preparing… and shows the first stage once the file is prepared', () => {
    renderStage({ kind: 'preparing', progress: START_PREPARE_PROGRESS });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Preparing…' });
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Probing the recording…')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Preparation progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('keeps the loading feedback in the centered stack with the CTA (#167)', () => {
    renderStage({ kind: 'preparing', progress: START_PREPARE_PROGRESS });
    const notice = screen.getByText('Probing the recording…').closest('.prepare-status');
    expect(notice?.closest('.stage-empty')).not.toBeNull();
    expect(document.querySelector('.player-notices')).toBeNull();
  });

  it('shows the running stage copy and the bar position with no warm-up copy', () => {
    renderStage({ kind: 'preparing', progress: { stage: 'plan', done: 2, total: 3 } });
    expect(screen.getByText('Planning the view…')).toBeTruthy();
    expect(screen.queryByText(/Warming tiles/)).toBeNull();
    const bar = screen.getByRole('progressbar', { name: 'Preparation progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('67');
  });

  it('reports a cancel with the CTA back in play', () => {
    renderStage({ kind: 'canceled' });
    expect(screen.getByText('No recording picked.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' }).disabled).toBe(false);
  });

  it('reports failures with their message', () => {
    renderStage({ kind: 'error', message: 'boom' });
    expect(screen.getByText('Could not open the recording: boom')).toBeTruthy();
  });

  it('turns a known failure into a sentence and keeps the original as details', () => {
    renderStage({ kind: 'error', message: 'not a readable .mp4 file: C:\\Windows\\win.ini' });
    expect(
      screen.getByText('Could not open the recording: "win.ini" is not a readable .mp4 recording.'),
    ).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText('not a readable .mp4 file: C:\\Windows\\win.ini')).toBeTruthy();
  });

  it('dismisses a failure through its notice', async () => {
    const { onDismiss } = renderStage({ kind: 'error', message: 'boom' });
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe.each<PickState>([{ kind: 'idle' }, { kind: 'picking' }, { kind: 'ready' }])(
  'an empty stage in the $kind state',
  (state) => {
    it('shows no status line', () => {
      renderStage(state);
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  },
);
