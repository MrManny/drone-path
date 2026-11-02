// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PickResult, UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { PrepareProgress } from '../../src/run.js';
import type { Scene } from '../../src/renderer/scene.js';
import Page from '../../ui/app/page.js';

const fakeScene = vi.hoisted((): Scene => ({
  setFrame: vi.fn(() => Promise.resolve()),
  relayout: vi.fn(),
  update: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
}));

// The real island loads Leaflet after mount; the stub keeps that timing.
vi.mock('../../ui/components/MapIsland.js', async () => {
  const { useEffect } = await import('react');
  return {
    MapIsland: ({ onScene }: { onScene: (scene: Scene) => void }) => {
      useEffect(() => {
        const t = setTimeout(() => onScene(fakeScene), 0);
        return () => clearTimeout(t);
      }, [onScene]);
      return <div data-testid="map-island" />;
    },
  };
});

const SESSION: UiSession = {
  scene: {
    style: 'satellite',
    tileUrl: '/tiles/satellite/{z}/{x}/{y}.png',
    view: 'overview',
    width: 768,
    height: 768,
    zoom: 15,
    center: { lat: 46.61, lon: 14.26 },
    attribution: 'Test Attribution',
    introN: 0,
    outroN: 0,
    lat: [46.61, 46.611, 46.612],
    lon: [14.26, 14.261, 14.262],
    alt: [10, 11, null],
    speed: [null, 2.5, 3.1],
    headingDeg: [0, 90, 180],
    hud: { heading: true, alt: true, speed: true },
    trailLat: [46.61, 46.612],
    trailLon: [14.26, 14.262],
    trailFrame: [0, 2],
  },
  video: { src: '/video', fps: 30, frames: 90, width: 1512, height: 2688 },
  tileBase: '/tiles',
  bbox: { minLat: 46.6, maxLat: 46.612, minLon: 14.26, maxLon: 14.262 },
  durationSec: 3,
};

// The bridge stands in for the shell: the test decides when the native picker
// returns, when the shell reports that a valid file is being prepared, and how
// the preparation progresses.
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
  };
  (window as { neo2flightpath?: unknown }).neo2flightpath = bridge;
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

async function openLanding() {
  render(<Page />);
  return screen.findByRole('button', { name: 'Open…' });
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  delete (window as { neo2flightpath?: unknown }).neo2flightpath;
});

describe('Open flow on the landing', () => {
  it('shows no busy status while the native picker is open', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    expect(harness.bridge.pickRecording).toHaveBeenCalledTimes(1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' }).disabled).toBe(false);
    expect(screen.queryByText(/Preparing/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows Preparing only after the shell reports a valid file', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    expect(screen.queryByText(/Preparing/)).toBeNull();
    harness.prepare();
    expect(screen.getByText('Probing the recording…')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Preparing…' }).disabled).toBe(true);
    await harness.settle({ ok: true });
  });

  it('tracks the preparation progress on the loading bar', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    harness.prepare();
    harness.report({ stage: 'tiles', done: 3, total: 51, tilesDone: 0, tilesTotal: 48 });
    expect(screen.getByText('Warming tiles… 0/48')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Preparation progress' }).getAttribute('aria-valuenow'),
    ).toBe('6');
    harness.report({ stage: 'tiles', done: 15, total: 51, tilesDone: 12, tilesTotal: 48 });
    expect(screen.getByText('Warming tiles… 12/48')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Preparation progress' }).getAttribute('aria-valuenow'),
    ).toBe('29');
    await harness.settle({ ok: true });
  });

  it('opens the player once the picked recording loads', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    harness.prepare();
    await harness.settle({ ok: true });
    await waitFor(() => expect(document.querySelector('.controls')).not.toBeNull());
  });

  it('ignores a second Open while the first pick is still running', async () => {
    const harness = installBridge();
    const open = await openLanding();
    fireEvent.click(open);
    fireEvent.click(open);
    expect(harness.bridge.pickRecording).toHaveBeenCalledTimes(1);
    await harness.settle({ ok: false, canceled: true });
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
  it('shows that outcome and never a busy status', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    await harness.settle(result);
    expect(screen.getByRole(role).textContent).toContain(text);
    expect(screen.queryByText(/Preparing/)).toBeNull();
  });
});

describe('Open flow over the player', () => {
  it('keeps the recording and offers a dismissible notice when Open fails', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    harness.prepare();
    await harness.settle({ ok: true });
    await waitFor(() => expect(document.querySelector('.controls')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Open…' }));
    await harness.settle({ ok: false, error: 'not a readable .mp4 file: C:\\Windows\\win.ini' });
    expect(screen.getByRole('alert').textContent).toContain('"win.ini" is not a readable .mp4 recording.');
    expect(document.querySelector('.controls')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.controls')).not.toBeNull();
  });
});

describe('update prompt', () => {
  it('prompts over the landing once the background download finishes', async () => {
    const harness = installBridge();
    await openLanding();
    harness.updateReady();
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('A new version is ready to install.');
  });

  it('waits out another dialog and then prompts exactly once', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    harness.prepare();
    await harness.settle({ ok: true });
    await waitFor(() => expect(document.querySelector('.controls')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
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
    await openLanding();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(harness.bridge.restartToUpdate).toHaveBeenCalledTimes(1);
  });

  it('offers the prompt again when the restart could not start', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockRejectedValueOnce(new Error('shell gone'));
    await openLanding();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy(),
    );
  });

  it('dismisses the prompt with Escape', async () => {
    const harness = installBridge();
    await openLanding();
    harness.updateReady();
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Update' })).toBeNull();
  });

  it('locks even Escape while the restart runs', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockReturnValueOnce(new Promise<{ ok: boolean }>(() => {}));
    await openLanding();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(screen.getByRole('button', { name: 'Restarting…' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
  });

  it('unlocks the prompt when the shell refuses to restart', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockResolvedValueOnce({ ok: false, error: 'no update' });
    await openLanding();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy());
  });

  it('unlocks the prompt when the restart fails after the ack', async () => {
    const harness = installBridge();
    harness.bridge.restartToUpdate.mockReturnValueOnce(new Promise<{ ok: boolean }>(() => {}));
    await openLanding();
    harness.updateReady();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    harness.restartFailed();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy());
  });

  it('picks up a download that finished before the subscription', async () => {
    const harness = installBridge();
    harness.bridge.getUpdateState.mockResolvedValueOnce({ ready: true });
    await openLanding();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy());
  });
});
