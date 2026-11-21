// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GeneratedCatalogs from '../../src/desktop-i18n/generated/catalogs.js';

import type { PickResult } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import type { RenderConfig } from 'drone-path-engine/config';
import type { PrepareProgress } from 'drone-path-engine/pipeline';
import type { Scene } from 'drone-path-engine/renderer/scene';
import Page from '../../ui/app/page.js';
import { SESSION, flushRaf, installRafStub, installResizeObserverStub } from './harness.js';

vi.mock('../../src/desktop-i18n/generated/catalogs.js', async (importOriginal) => {
  const { catalogs } = await importOriginal<typeof GeneratedCatalogs>();
  return {
    catalogs: {
      en: catalogs.en,
      de: {
        'app.title': 'Deutscher Fenstertitel',
        'emptyStage.open': 'Öffnen…',
        'settings.title': 'Einstellungen',
        'settings.language': 'Sprache',
        'settings.system': 'Systemstandard',
      },
    },
  };
});

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { createFakeScene, delayedMapIslandMock } = await import('./harness.js');
  return delayedMapIslandMock(createFakeScene());
});

vi.mock('drone-path-engine/renderer/boot', async () => {
  const { createFakeScene } = await import('./harness.js');
  return {
    bootScene: (): Scene => createFakeScene(),
  };
});

vi.mock('leaflet', () => ({ default: {} }));

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
    getLanguage: vi.fn(async () => ({ preference: null as string | null, locale: 'en' })),
    saveLanguage: vi.fn(async (preference: string | null) => ({
      ok: true,
      preference,
      locale: preference ?? 'en',
    })),
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

function menuItem(name: string): HTMLButtonElement {
  return within(screen.getByRole('menu')).getByRole<HTMLButtonElement>('menuitem', { name });
}

const MENU_OF_ITEM: Record<string, 'File' | 'View' | 'Help'> = {
  'Open…': 'File',
  'Export video…': 'File',
  'Export telemetry…': 'File',
  'Map appearance…': 'View',
  Exit: 'File',
  'Picture in picture': 'View',
  'User manual': 'Help',
  About: 'Help',
};

function clickMenuItem(name: string): void {
  fireEvent.click(screen.getByRole('menuitem', { name: MENU_OF_ITEM[name] }));
  fireEvent.click(menuItem(name));
}

function openWorkspace() {
  render(<Page />);
  return stageCta();
}

const ROWS = ['.menu-bar', '.workspace-header', '.stage', '.transport', '.timeline'];

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
  installResizeObserverStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  delete (window as { dronepath?: unknown }).dronepath;
});

describe('the empty workspace at launch', () => {
  it('lands in the five-row skeleton with disabled controls and one accent CTA', () => {
    installBridge();
    openWorkspace();
    expect(rowGeometry().map((row) => row.split(' @ ')[0])).toEqual([
      'menu-bar',
      'workspace-header',
      'stage stage-split',
      'transport',
      'timeline',
    ]);
    expect(document.querySelector('.status-bar')).toBeNull();
    expect(stageCta().textContent).toContain('Open…');
    expect(document.querySelectorAll('button.primary')).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(menuItem('Open…').getAttribute('aria-disabled')).toBeNull();
    expect(menuItem('Export video…').getAttribute('aria-disabled')).toBe('true');
    for (const name of ['Jump to start', 'Play', 'Jump to end', '1×', '2×', '3×', '4×']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
    expect(
      screen.getByRole<HTMLButtonElement>('slider', { name: 'Playback position' }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(menuItem('Map appearance…').getAttribute('aria-disabled')).toBeNull();
    expect(menuItem('Picture in picture').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    expect(menuItem('User manual').getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByText('No flight path yet.')).toBeTruthy();
    expect(screen.queryByText('No recording loaded')).toBeNull();
    expect(screen.queryByText(/SRT sidecar/)).toBeNull();
    expect(screen.queryByText(/Recording ·/)).toBeNull();
  });

  it('opens the Map appearance dialog with no recording loaded (#236)', () => {
    installBridge();
    openWorkspace();
    clickMenuItem('Map appearance…');
    const dialog = screen.getByRole('dialog', { name: 'Map appearance' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(
      screen.getByText('Example flight — open a recording to preview yours'),
    ).toBeTruthy();
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
    expect(screen.getByText('Reading the recording…')).toBeTruthy();
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
    expect(screen.getByText('Setting up the map…')).toBeTruthy();
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
    expect(screen.getByText('Recording · 0:03')).toBeTruthy();
    expect(document.querySelector('.status-bar')).toBeNull();
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

describe('workspace row fitting (#234)', () => {
  // The fixed chrome rows must fit the app's 600px minimum window height
  // (app/main.mjs minHeight) with room left for the footage stage at every
  // timeline height, or rows clip and the window grows stray scrollbars.
  const cssText = fs.readFileSync(path.join(root, 'ui', 'app', 'globals.css'), 'utf8');

  function allTokenPx(name: string): number[] {
    return [...cssText.matchAll(new RegExp(`${name}:\\s*(\\d+)px`, 'g'))].map((m) => Number(m[1]));
  }

  it('leaves stage headroom at the minimum window height', () => {
    const MIN_WINDOW_H = 600;
    const MIN_STAGE_H = 250;
    const menuH = 33; // .menu-bar: the 32px row plus its 1px hairline border
    const fixed = menuH + allTokenPx('--header-h')[0] + allTokenPx('--transport-h')[0];
    const timelines = allTokenPx('--timeline-h');
    expect(timelines.length).toBeGreaterThanOrEqual(2);
    for (const timelineH of timelines) {
      expect(fixed + timelineH + MIN_STAGE_H).toBeLessThanOrEqual(MIN_WINDOW_H);
    }
  });

  it('keeps the workspace unscrollable with the stage as the only flexible row', () => {
    expect(cssText).toMatch(/\.workspace\s*\{[^}]*height: 100vh/);
    for (const row of ['\\.menu-bar', '\\.workspace-header', '\\.transport', '\\.timeline']) {
      expect(cssText).toMatch(new RegExp(`${row}\\s*\\{[^}]*flex: none`));
    }
    expect(cssText).toMatch(/\.stage\s*\{[^}]*flex: 1 1 auto/);
    expect(cssText).not.toMatch(/\.status-(bar|item)\s*\{/);
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
    { name: 'P', key: 'p' },
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

describe('menu bar label navigation (#238)', () => {
  it('keeps the label arrows on the menu bar and away from the player shortcuts', async () => {
    const harness = installBridge();
    openWorkspace();
    await commitLoaded(harness);
    const [file, view] = [...document.querySelectorAll<HTMLButtonElement>('.menu-bar-label')];
    const scrubber = document.querySelector<HTMLInputElement>('.timeline input[type="range"]');
    const before = scrubber?.value ?? '0';
    file.focus();
    fireEvent.keyDown(file, { key: 'ArrowRight' });
    act(() => flushRaf());
    // The label focus move proves the menu bar won the window-capture race
    // against the player hotkeys; a frame step would rewrite the scrubber.
    expect(document.activeElement).toBe(view);
    expect(scrubber?.value ?? '0').toBe(before);
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

  it('opens the About dialog from Help → About and closes it on Escape', async () => {
    const { BUILD_VERSION } = await import('../../ui/lib/buildinfo/generated/buildinfo.js');
    openWorkspace();
    clickMenuItem('About');
    const dialog = screen.getByRole('dialog', { name: 'About' });
    const version = within(dialog).getByText(/^Version /).textContent ?? '';
    expect(version.startsWith(`Version ${BUILD_VERSION}`)).toBe(true);
    const link = within(dialog).getByRole('link', { name: 'MrManny/drone-path' });
    expect(link.getAttribute('href')).toBe('https://github.com/MrManny/drone-path');
    expect(link.getAttribute('target')).toBe('_blank');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'About' })).toBeNull();
    expect(document.querySelector('.workspace')).not.toBeNull();
  });

  it('reaches About through the Help mnemonic and the arrow keys', () => {
    openWorkspace();
    fireEvent.keyDown(window, { key: 'h', altKey: true });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'About' })).toBeTruthy();
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
    text: 'Could not open the recording: "win.ini" is not a readable .mp4 recording. Choose a different .mp4 file.',
    role: 'alert',
  },
  {
    outcome: 'the backend reports an unknown failure',
    result: { ok: false, error: 'disk on fire' },
    text: 'Could not open the recording: Something went wrong. Try again.',
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
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(text)).toBeNull();
    expect(stageCta().disabled).toBe(false);
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

  it('seeds the Map appearance dialog from the persisted look', async () => {
    await openPlayerWith({ ...DEFAULT_CONFIG, style: 'topo', view: 'overview', zoomOut: 3 });
    clickMenuItem('Map appearance…');
    expect(screen.getByRole('button', { name: 'Topographic' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByLabelText<HTMLInputElement>('Frame padding').value).toBe('3');
    // Zoom is the exception: opening a recording resets it to auto-fit (#270).
    expect(
      (screen.getByRole<HTMLInputElement>('checkbox', { name: 'Auto-fit zoom' })).checked,
    ).toBe(true);
  });

  it('normalizes a stale stored zoom to one usable level on load (#271)', async () => {
    const harness = installBridge();
    harness.bridge.getSettings.mockResolvedValue({ ...DEFAULT_CONFIG, zoom: 25 });
    openWorkspace();
    await act(async () => {});
    clickMenuItem('Map appearance…');
    expect(screen.getByLabelText<HTMLInputElement>('Zoom level').value).toBe('19');
    expect(harness.bridge.saveSettings).not.toHaveBeenCalled();
  });

  it('persists every Map appearance change through the backend', async () => {
    const harness = await openPlayerWith(DEFAULT_CONFIG);
    expect(harness.bridge.saveSettings).not.toHaveBeenCalled();
    clickMenuItem('Map appearance…');
    fireEvent.click(screen.getByRole('button', { name: 'Topographic' }));
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
    fireEvent.change(screen.getByLabelText('Codec'), { target: { value: 'h265' } });
    expect(harness.bridge.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ codec: 'h265' }),
    );
  });
});

describe('map zoom reset on open (#270)', () => {
  it('prepares and opens a recording at auto-fit regardless of the previous pin', async () => {
    const harness = installBridge();
    harness.bridge.getSettings.mockResolvedValue({ ...DEFAULT_CONFIG, zoom: 12 });
    openWorkspace();
    // Let the persisted settings land, so the pick runs from a pinned zoom.
    await act(async () => {});
    await commitLoaded(harness);

    expect(harness.bridge.pickRecording).toHaveBeenCalledWith({
      settings: expect.objectContaining({ zoom: 0 }),
    });
    expect(screen.getByText('auto-fit')).toBeTruthy();
    clickMenuItem('Map appearance…');
    expect(
      (screen.getByRole<HTMLInputElement>('checkbox', { name: 'Auto-fit zoom' })).checked,
    ).toBe(true);
  });

  it('keeps the zoom choice when the picker is canceled', async () => {
    const harness = installBridge();
    harness.bridge.getSettings.mockResolvedValue({ ...DEFAULT_CONFIG, zoom: 12 });
    openWorkspace();
    fireEvent.click(stageCta());
    await harness.settle({ ok: false, canceled: true });

    clickMenuItem('Map appearance…');
    expect(screen.getByLabelText<HTMLInputElement>('Zoom level').value).toBe('12');
  });
});

describe('update prompt', () => {
  it('prompts over the empty workspace once the background download finishes', async () => {
    const harness = installBridge();
    openWorkspace();
    harness.updateReady();
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
    expect(screen.getByText(/^A new version is ready to install\./).closest('[role="status"]')).toBeTruthy();
  });

  it('waits out another dialog and then prompts exactly once', async () => {
    const harness = installBridge();
    openWorkspace();
    await commitLoaded(harness);

    clickMenuItem('User manual');
    harness.updateReady();
    expect(screen.queryByRole('dialog', { name: 'Update' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Update' })).getByRole('button', { name: 'Close' }),
    );
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

  it('offers the prompt again with the failure when the restart could not start', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockRejectedValueOnce(new Error('shell gone'));
    openWorkspace();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain(
      'The restart failed. Try again, or install the update when you quit.',
    );
    expect(screen.getByText('shell gone')).toBeTruthy();
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
    expect(screen.getByText('Restarting…').getAttribute('role')).toBe('status');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restart now' }).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
  });

  it('unlocks the prompt and reports the failure when the shell refuses to restart', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockResolvedValueOnce({ ok: false, error: 'no update' });
    openWorkspace();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain(
      'The restart failed. Try again, or install the update when you quit.',
    );
    expect(screen.getByText('no update')).toBeTruthy();
  });

  it('unlocks the prompt and reports the failure when the restart fails after the ack', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockReturnValueOnce(new Promise<{ ok: boolean }>(() => {}));
    openWorkspace();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    harness.restartFailed();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain(
      'The restart failed. Try again, or install the update when you quit.',
    );
    expect(screen.getByText('restart failed')).toBeTruthy();
  });

  it('ignores a duplicate restart failure for the same attempt and allows retrying', async () => {
    const harness = installBridge();
    let resolveRestart!: (ack: { ok: boolean; error?: string }) => void;
    harness.bridge.restartToUpdate.mockImplementationOnce(
      () =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          resolveRestart = resolve;
        }),
    );
    openWorkspace();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    harness.restartFailed();
    await act(async () => {
      resolveRestart({ ok: false, error: 'duplicate error' });
    });

    expect(screen.getByText('restart failed')).toBeTruthy();
    expect(screen.queryByText('duplicate error')).toBeNull();

    // A subsequent retry can report its own failure cleanly.
    harness.bridge.restartToUpdate.mockResolvedValueOnce({ ok: false, error: 'retry failed' });
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(screen.getByText('retry failed')).toBeTruthy());
  });

  it('picks up a download that finished before the subscription', async () => {
    const harness = installBridge();
    harness.bridge.getUpdateState.mockResolvedValueOnce({ ready: true });
    openWorkspace();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy());
  });
});


describe('desktop language selector', () => {
  function openSettings() {
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings…' }));
  }

  it('updates the open dialog, the workspace, and the document language without a restart', async () => {
    const { bridge } = installBridge();
    render(<Page />);

    openSettings();
    const language = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Language' });
    expect(language.value).toBe('');
    expect(within(language).getByRole('option', { name: 'Deutsch' })).toBeTruthy();
    fireEvent.change(language, { target: { value: 'de' } });

    const settings = await screen.findByRole('dialog', { name: 'Einstellungen' });
    const localized = within(settings).getByRole<HTMLSelectElement>('combobox', { name: 'Sprache' });
    expect(localized.value).toBe('de');
    expect(bridge.saveLanguage).toHaveBeenCalledWith('de');
    expect(screen.getByRole('button', { name: 'Öffnen…' })).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('de');
      expect(document.title).toBe('Deutscher Fenstertitel');
    });

    fireEvent.change(localized, { target: { value: '' } });
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(bridge.saveLanguage).toHaveBeenLastCalledWith(null);
  });

  it('loads the effective system language and keeps it if saving fails', async () => {
    const { bridge } = installBridge();
    bridge.getLanguage.mockResolvedValue({ preference: null, locale: 'de' });
    bridge.saveLanguage.mockResolvedValue({ ok: false, preference: null, locale: 'de' });
    render(<Page />);
    expect(await screen.findByRole('button', { name: 'Öffnen…' })).toBeTruthy();

    openSettings();
    const language = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Sprache' });
    expect(language.value).toBe('');
    fireEvent.change(language, { target: { value: 'en' } });
    expect((await screen.findByRole('alert')).textContent).toContain('The language setting could not be saved.');
    expect(language.value).toBe('');
    expect(document.documentElement.lang).toBe('de');
  });
});

describe('initial getSettings race guard (#313)', () => {
  it('does not overwrite an earlier user settings edit when getSettings resolves late', async () => {
    let resolveSettings: (config: RenderConfig) => void = () => {};
    const harness = installBridge();
    harness.bridge.getSettings.mockImplementation(
      () =>
        new Promise<RenderConfig>((resolve) => {
          resolveSettings = resolve;
        }),
    );

    openWorkspace();
    clickMenuItem('Map appearance…');
    fireEvent.click(screen.getByRole('button', { name: 'Topographic' }));
    expect(harness.bridge.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'topo' }),
    );

    await act(async () => {
      resolveSettings({ ...DEFAULT_CONFIG, style: 'satellite' });
    });

    expect(
      screen.getByRole('button', { name: 'Topographic' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
