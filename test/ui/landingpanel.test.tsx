// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { LandingPanel } from '../../ui/components/LandingPanel.js';
import { START_PREPARE_PROGRESS } from '../../ui/lib/pickstate.js';
import type { PickState } from '../../ui/lib/pickstate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// jsdom does no layout, so the placement pins read the real stylesheet's
// computed values: deterministic and offline.
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

describe('LandingPanel', () => {
  it('offers the pick flow when idle', () => {
    render(<LandingPanel state={{ kind: 'idle' }} onPick={() => {}} onHelp={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open…' })).toBeTruthy();
    expect(screen.getByText(/SRT sidecar/)).toBeTruthy();
  });

  it('keeps the status line empty while the native picker is open', () => {
    render(<LandingPanel state={{ kind: 'picking' }} onPick={() => {}} onHelp={() => {}} />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' });
    expect(button.disabled).toBe(false);
    expect(screen.queryByText(/Preparing/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the loading bar and the first stage once the file is being prepared', () => {
    render(
      <LandingPanel
        state={{ kind: 'preparing', progress: START_PREPARE_PROGRESS }}
        onPick={() => {}} onHelp={() => {}}
      />,
    );
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Preparing…' });
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Probing the recording…')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Preparation progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('shows the running stage copy and the bar position', () => {
    render(
      <LandingPanel
        state={{
          kind: 'preparing',
          progress: { stage: 'plan', done: 2, total: 3 },
        }}
        onPick={() => {}} onHelp={() => {}}
      />,
    );
    expect(screen.getByText('Planning the view…')).toBeTruthy();
    expect(screen.queryByText(/Warming tiles/)).toBeNull();
    const bar = screen.getByRole('progressbar', { name: 'Preparation progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('67');
  });

  it('reports a cancel', () => {
    render(<LandingPanel state={{ kind: 'canceled' }} onPick={() => {}} onHelp={() => {}} />);
    expect(screen.getByText('No recording picked.')).toBeTruthy();
  });

  it('reports failures with their message', () => {
    render(<LandingPanel state={{ kind: 'error', message: 'boom' }} onPick={() => {}} onHelp={() => {}} />);
    expect(screen.getByText('Could not open the recording: boom')).toBeTruthy();
  });

  it('turns a known failure into a sentence and keeps the original as details', () => {
    render(
      <LandingPanel
        state={{ kind: 'error', message: 'not a readable .mp4 file: C:\\Windows\\win.ini' }}
        onPick={() => {}} onHelp={() => {}}
      />,
    );
    expect(
      screen.getByText('Could not open the recording: "win.ini" is not a readable .mp4 recording.'),
    ).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText('not a readable .mp4 file: C:\\Windows\\win.ini')).toBeTruthy();
  });

  it('dismisses a failure through its notice', async () => {
    const onDismiss = vi.fn();
    render(
      <LandingPanel state={{ kind: 'error', message: 'boom' }} onPick={() => {}} onHelp={() => {}} onDismiss={onDismiss} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('invokes onPick on click', async () => {
    const onPick = vi.fn();
    render(<LandingPanel state={{ kind: 'idle' }} onPick={onPick} onHelp={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open…' }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('invokes onHelp on click', async () => {
    const onHelp = vi.fn();
    render(<LandingPanel state={{ kind: 'idle' }} onPick={() => {}} onHelp={onHelp} />);
    await userEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  it('offers help as an icon-only button with a tooltip', () => {
    render(<LandingPanel state={{ kind: 'idle' }} onPick={() => {}} onHelp={() => {}} />);
    const help = screen.getByRole('button', { name: 'Help' });
    expect(help.getAttribute('aria-label')).toBe('Help');
    expect(help.getAttribute('title')).toBe('Help');
    expect(help.textContent).toBe('');
  });
});

describe.each<PickState>([{ kind: 'idle' }, { kind: 'picking' }, { kind: 'ready' }])(
  'a landing in the $kind state',
  (state) => {
    it('shows no status line', () => {
      render(<LandingPanel state={state} onPick={() => {}} onHelp={() => {}} />);
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  },
);

describe('LandingPanel layout', () => {
  it('pins the help button to the card top right', () => {
    render(<LandingPanel state={{ kind: 'idle' }} onPick={() => {}} onHelp={() => {}} />);
    const style = getComputedStyle(screen.getByRole('button', { name: 'Help' }));
    expect(style.position).toBe('absolute');
    expect(style.top).toBe('24px');
    expect(style.right).toBe('24px');
  });

  it('centers the Open button and holds it wide', () => {
    const { container } = render(
      <LandingPanel state={{ kind: 'idle' }} onPick={() => {}} onHelp={() => {}} />,
    );
    const row = container.querySelector('.landing-actions') as HTMLElement;
    expect(getComputedStyle(row).justifyContent).toBe('center');
    const open = screen.getByRole('button', { name: 'Open…' });
    expect(getComputedStyle(open).width).toBe('320px');
    expect(getComputedStyle(open).maxWidth).toBe('100%');
  });
});
