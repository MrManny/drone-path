// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PickResult } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import type { PrepareProgress } from '../../src/run.js';
import Page from '../../ui/app/page.js';
import { SESSION, installRafStub } from './harness.js';

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { createFakeScene, delayedMapIslandMock } = await import('./harness.js');
  return delayedMapIslandMock(createFakeScene());
});

vi.mock('../../ui/components/ExportPreview.js', async () => {
  const { stubExportPreviewMock } = await import('./harness.js');
  return stubExportPreviewMock();
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

function installBridge() {
  const pending: Array<(result: PickResult) => void> = [];
  const listeners: {
    preparing?: () => void;
    progress?: (progress: PrepareProgress) => void;
    updateReady?: () => void;
    restartFailed?: (message: string) => void;
  } = {};
  const bridge = {
    getSettings: vi.fn(async () => DEFAULT_CONFIG),
    saveSettings: vi.fn(async () => ({ ok: true })),
    getSession: vi.fn(async () => SESSION),
    pickRecording: vi.fn(
      () =>
        new Promise<PickResult>((resolve) => {
          pending.push(resolve);
        }),
    ),
    onPreparing: vi.fn((cb: () => void) => {
      listeners.preparing = cb;
      return () => {
        listeners.preparing = undefined;
      };
    }),
    onPrepareProgress: vi.fn((cb: (progress: PrepareProgress) => void) => {
      listeners.progress = cb;
      return () => {
        listeners.progress = undefined;
      };
    }),
    onUpdateReady: vi.fn((cb: () => void) => {
      listeners.updateReady = cb;
      return () => {
        listeners.updateReady = undefined;
      };
    }),
    onUpdateRestartFailed: vi.fn((cb: (message: string) => void) => {
      listeners.restartFailed = cb;
      return () => {
        listeners.restartFailed = undefined;
      };
    }),
    getUpdateState: vi.fn(async () => ({ ready: false })),
    restartToUpdate: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
    closeWindow: vi.fn(async () => {}),
  };
  (window as { dronepath?: unknown }).dronepath = bridge;
  return {
    bridge,
    prepare: () => {
      act(() => {
        listeners.preparing?.();
      });
    },
    report: (progress: PrepareProgress) => {
      act(() => {
        listeners.progress?.(progress);
      });
    },
    updateReady: () => {
      act(() => {
        listeners.updateReady?.();
      });
    },
    restartFailed: () => {
      act(() => {
        listeners.restartFailed?.('restart failed');
      });
    },
    settle: async (result: PickResult) => {
      const resolve = pending.shift();
      if (!resolve) throw new Error('no pick is waiting for a reply');
      await act(async () => {
        resolve(result);
      });
    },
  };
}

function stageCta(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    '.stage-empty button.primary',
  ) as HTMLButtonElement;
}

function menuBar(): HTMLElement {
  return document.querySelector('.menu-bar') as HTMLElement;
}

function menuItem(name: string): HTMLButtonElement {
  return within(menuBar()).getByRole<HTMLButtonElement>('menuitem', { name });
}

const MENU_OF_ITEM: Record<string, 'File' | 'View' | 'Help'> = {
  'Open…': 'File',
  'Export video…': 'File',
  'Export telemetry…': 'File',
  Settings: 'File',
  Exit: 'File',
  Swap: 'View',
  Documentation: 'Help',
};

function clickMenuItem(name: string): void {
  fireEvent.click(screen.getByRole('menuitem', { name: MENU_OF_ITEM[name] }));
  fireEvent.click(menuItem(name));
}

function openWorkspace() {
  render(<Page />);
  return stageCta();
}

const ROWS = ['.menu-bar', '.workspace-header', '.stage', '.transport', '.timeline', '.status-bar'];

function rowGeometry(): string[] {
  return ROWS.map((selector) => {
    const row = document.querySelector(selector) as HTMLElement;
    return `${row.className} @ ${getComputedStyle(row).height}`;
  });
}

async function commitLoaded(harness: ReturnType<typeof installBridge>) {
  fireEvent.click(stageCta());
  harness.prepare();
  await harness.settle({ ok: true });
  await waitFor(() => expect(document.querySelector('.pane-video video')).not.toBeNull());
  return harness;
}

beforeEach(() => {
  installRafStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  delete (window as { dronepath?: unknown }).dronepath;
});

describe('the empty workspace at launch', () => {
  it('lands in the six-row skeleton with disabled controls and one accent CTA', () => {
    installBridge();
    openWorkspace();
    expect(rowGeometry().map((row) => row.split(' @ ')[0])).toEqual([
      'menu-bar',
      'workspace-header',
      'stage stage-split',
      'transport',
      'timeline',
      'status-bar',
    ]);
    expect(stageCta().textContent).toContain('Open…');
    expect(document.querySelectorAll('button.primary')).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(menuItem('Open…').disabled).toBe(false);
    expect(menuItem('Export video…').disabled).toBe(true);
    for (const name of ['Jump to start', 'Play', 'Jump to end', '1×', '2×', '3×', '4×']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
    expect(
      screen.getByRole<HTMLButtonElement>('slider', { name: 'Playback position' }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(menuItem('Swap').disabled).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    expect(menuItem('Documentation').disabled).toBe(false);
    expect(screen.getByText('No telemetry yet')).toBeTruthy();
    expect(screen.getByText('No recording loaded')).toBeTruthy();
    expect(screen.getByText(/SRT sidecar/)).toBeTruthy();
  });

  it('shows no busy status while the native picker is open', () => {
    const harness = installBridge();
    fireEvent.click(openWorkspace());
    expect(harness.bridge.pickRecording).toHaveBeenCalledTimes(1);
    expect(stageCta().disabled).toBe(false);
    expect(screen.queryByText(/Preparing/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows Preparing… only after the shell reports a valid file', async () => {
    const harness = installBridge();
    fireEvent.click(openWorkspace());
    expect(screen.queryByText(/Preparing/)).toBeNull();
    harness.prepare();
    expect(screen.getByText('Probing the recording…')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Preparing…' }).disabled).toBe(true);
    await harness.settle({ ok: true });
  });

  it('tracks the preparation progress on the loading bar with no warm-up copy', async () => {
    const harness = installBridge();
    fireEvent.click(openWorkspace());
    harness.prepare();
    harness.report({ stage: 'telemetry', done: 1, total: 3 });
    expect(screen.getByText('Loading telemetry…')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Preparation progress' }).getAttribute('aria-valuenow'),
    ).toBe('33');
    harness.report({ stage: 'plan', done: 2, total: 3 });
    expect(screen.getByText('Planning the view…')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Preparation progress' }).getAttribute('aria-valuenow'),
    ).toBe('67');
    expect(screen.queryByText(/Warming tiles/)).toBeNull();
    await harness.settle({ ok: true });
  });

  it('swaps to the player with unchanged row geometry', async () => {
    const harness = installBridge();
    openWorkspace();
    const before = rowGeometry();
    await commitLoaded(harness);
    expect(rowGeometry()).toEqual(before);
    expect(stageCta()).toBeNull();
    expect(document.querySelector('.workspace')).not.toBeNull();
  });

  it('ignores a second Open while the first pick is still running', async () => {
    const harness = installBridge();
    const open = openWorkspace();
    fireEvent.click(open);
    fireEvent.click(open);
    expect(harness.bridge.pickRecording).toHaveBeenCalledTimes(1);
    await harness.settle({ ok: false, canceled: true });
  });
});

describe('keyboard before a recording loads', () => {
  it('opens the pick flow with Ctrl+O', () => {
    const harness = installBridge();
    openWorkspace();
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    expect(harness.bridge.pickRecording).toHaveBeenCalledTimes(1);
  });

  it.for([
    { name: 'Space', key: ' ' },
    { name: 'K', key: 'k' },
    { name: 'Left', key: 'ArrowLeft' },
    { name: 'Right', key: 'ArrowRight' },
    { name: 'Shift+Left', key: 'ArrowLeft', shiftKey: true },
    { name: 'Home', key: 'Home' },
    { name: 'End', key: 'End' },
    { name: 'I', key: 'i' },
    { name: 'O', key: 'o' },
    { name: 'S', key: 's' },
    { name: '1', key: '1' },
    { name: '4', key: '4' },
  ])('lets the $name playback shortcut no-op', ({ key, shiftKey }) => {
    const harness = installBridge();
    openWorkspace();
    fireEvent.keyDown(window, { key, shiftKey });
    expect(harness.bridge.pickRecording).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.workspace')).not.toBeNull();
  });
});

describe('accent discipline', () => {
  it('wears the accent on the stage CTA alone before load and on no action after', async () => {
    const harness = installBridge();
    openWorkspace();
    expect(document.querySelectorAll('button.primary')).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(document.querySelector('.menu-row.primary')).toBeNull();
    await commitLoaded(harness);
    expect(document.querySelector('.workspace button.primary')).toBeNull();
    expect(document.querySelector('.workspace button.dialog-primary')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(document.querySelector('.menu-row.primary')).toBeNull();
  });
});

describe('menu bar commands', () => {
  it('closes the app from File → Exit through the shell close path', () => {
    const harness = installBridge();
    openWorkspace();
    clickMenuItem('Exit');
    expect(harness.bridge.closeWindow).toHaveBeenCalledTimes(1);
  });

  it('does nothing on File → Exit outside the app shell', () => {
    openWorkspace();
    clickMenuItem('Exit');
    expect(document.querySelector('.workspace')).not.toBeNull();
    expect(document.querySelector('.menu-panel')).toBeNull();
  });

  it('opens the recording dialog from File → Open…', () => {
    const harness = installBridge();
    openWorkspace();
    clickMenuItem('Open…');
    expect(harness.bridge.pickRecording).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.menu-panel')).toBeNull();
  });
});

describe.each([
  {
    outcome: 'the picker is canceled',
    result: { ok: false, canceled: true },
    text: 'No recording picked.',
    role: 'status',
  },
  {
    outcome: 'the file is not a readable .mp4',
    result: { ok: false, error: 'not a readable .mp4 file: C:\\Windows\\win.ini' },
    text: 'Could not open the recording: "win.ini" is not a readable .mp4 recording.',
    role: 'alert',
  },
  {
    outcome: 'the backend reports an unknown failure',
    result: { ok: false, error: 'disk on fire' },
    text: 'Could not open the recording: disk on fire',
    role: 'alert',
  },
])('when $outcome', ({ result, text, role }) => {
  it('shows that outcome with the workspace intact and the CTA back in play', async () => {
    const harness = installBridge();
    const open = openWorkspace();
    const before = rowGeometry();
    fireEvent.click(open);
    await harness.settle(result);
    expect(screen.getByRole(role).textContent).toContain(text);
    expect(screen.queryByText(/Preparing/)).toBeNull();
    expect(rowGeometry()).toEqual(before);
    expect(stageCta().disabled).toBe(false);
    expect(stageCta().textContent).toContain('Open…');
    expect(document.querySelectorAll('button.primary')).toHaveLength(1);
  });
});

describe('Open flow over the player', () => {
  it('keeps the recording and offers a dismissible notice when Open fails', async () => {
    const harness = installBridge();
    openWorkspace();
    await commitLoaded(harness);

    clickMenuItem('Open…');
    await harness.settle({ ok: false, error: 'not a readable .mp4 file: C:\\Windows\\win.ini' });
    expect(screen.getByRole('alert').textContent).toContain(
      '"win.ini" is not a readable .mp4 recording.',
    );
    expect(document.querySelector('.workspace')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.workspace')).not.toBeNull();
  });
});

describe('settings persistence', () => {
  async function openPlayerWith(settings: RenderConfig) {
    const harness = installBridge();
    harness.bridge.getSettings.mockResolvedValue(settings);
    openWorkspace();
    await commitLoaded(harness);
    return harness;
  }

  it('seeds the map appearance popover from the persisted look', async () => {
    await openPlayerWith({ ...DEFAULT_CONFIG, style: 'topo', view: 'overview', zoom: 15 });
    clickMenuItem('Settings');
    expect(screen.getByLabelText<HTMLSelectElement>('Map style').value).toBe('topo');
    expect(
      screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByLabelText<HTMLInputElement>('Zoom').value).toBe('15');
  });

  it('persists every panel change through the backend', async () => {
    const harness = await openPlayerWith(DEFAULT_CONFIG);
    expect(harness.bridge.saveSettings).not.toHaveBeenCalled();
    clickMenuItem('Settings');
    fireEvent.change(screen.getByLabelText('Map style'), { target: { value: 'topo' } });
    expect(harness.bridge.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        style: 'topo',
        hud: { heading: true, alt: false, speed: false },
      }),
    );
  });

  it('persists an encoder change from the export modal through the backend', async () => {
    const harness = await openPlayerWith(DEFAULT_CONFIG);
    expect(harness.bridge.saveSettings).not.toHaveBeenCalled();
    clickMenuItem('Export video…');
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'h265' } });
    expect(harness.bridge.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ codec: 'h265' }),
    );
  });
});

describe('update prompt', () => {
  it('prompts over the empty workspace once the background download finishes', async () => {
    const harness = installBridge();
    openWorkspace();
    harness.updateReady();
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('A new version is ready to install.');
  });

  it('waits out another dialog and then prompts exactly once', async () => {
    const harness = installBridge();
    openWorkspace();
    await commitLoaded(harness);

    clickMenuItem('Documentation');
    harness.updateReady();
    expect(screen.queryByRole('dialog', { name: 'Update' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog', { name: 'Update' })).toBeNull();
    harness.updateReady();
    expect(screen.queryByRole('dialog', { name: 'Update' })).toBeNull();
  });

  it('restarts into the update on request', async () => {
    const harness = installBridge();
    openWorkspace();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(harness.bridge.restartToUpdate).toHaveBeenCalledTimes(1);
  });

  it('offers the prompt again when the restart could not start', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockRejectedValueOnce(new Error('shell gone'));
    openWorkspace();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy());
  });

  it('dismisses the prompt with Escape', async () => {
    const harness = installBridge();
    openWorkspace();
    harness.updateReady();
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Update' })).toBeNull();
  });

  it('locks even Escape while the restart runs', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockReturnValueOnce(new Promise<{ ok: boolean }>(() => {}));
    openWorkspace();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(screen.getByRole('button', { name: 'Restarting…' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
  });

  it('unlocks the prompt when the shell refuses to restart', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockResolvedValueOnce({ ok: false, error: 'no update' });
    openWorkspace();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy());
  });

  it('unlocks the prompt when the restart fails after the ack', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockReturnValueOnce(new Promise<{ ok: boolean }>(() => {}));
    openWorkspace();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    harness.restartFailed();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy());
  });

  it('picks up a download that finished before the subscription', async () => {
    const harness = installBridge();
    harness.bridge.getUpdateState.mockResolvedValueOnce({ ready: true });
    openWorkspace();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy());
  });
});
