// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import type { Scene } from '../../src/renderer/scene.js';
import { PlayerChrome } from '../../ui/components/PlayerChrome.js';
import type { PlayerChromeProps } from '../../ui/components/PlayerChrome.js';
import { useDialogs } from '../../ui/hooks/useDialogs.js';
import { START_PREPARE_PROGRESS } from '../../ui/lib/pickstate.js';
import type { PickState } from '../../ui/lib/pickstate.js';

const fakeScene = vi.hoisted((): Scene => ({
  setFrame: vi.fn(() => Promise.resolve()),
  relayout: vi.fn(),
  update: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
}));

// The real island delivers its scene asynchronously (after the Leaflet
// chunk); the mock keeps that timing so late-arrival behavior stays covered.
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

const SETTINGS: RenderConfig = { ...DEFAULT_CONFIG };

// The player receives the app's one dialog machine from the page; the wrapper
// runs the real machine so dialog behavior stays what the page gets. Help
// defaults to a no-op so tests that do not exercise it stay quiet.
function Chrome({
  onHelp = () => {},
  ...props
}: Omit<PlayerChromeProps, 'dialogs' | 'onHelp'> & { onHelp?: () => void }) {
  const dialogs = useDialogs();
  return <PlayerChrome {...props} onHelp={onHelp} dialogs={dialogs} />;
}

const rafQueue: Array<(now: number) => void> = [];
let rafNow = 0;

function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) {
    rafNow += 100;
    cb(rafNow);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  rafQueue.length = 0;
  rafNow = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('PlayerChrome export form memory', () => {
  it('remembers the segment seed and the sizes across dialog opens', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const scrub = screen.getByRole('slider', { name: 'Playback position' });
    fireEvent.change(scrub, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set loop in' }));
    fireEvent.change(scrub, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set loop out' }));

    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /In–Out segment/ }).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '1024' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /In–Out segment/ }).checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Width').value).toBe('1024');
  });
});

describe('PlayerChrome workspace structure', () => {
  it('keeps the header, transport, timeline and status bar actions reachable', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    // Header
    expect(screen.getByRole('button', { name: 'Open…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export…' })).toBeTruthy();
    // Transport
    expect(screen.getByRole('button', { name: 'Jump to start' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Play|Warming tiles/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Jump to end' })).toBeTruthy();
    // The transport and the map card share one position readout text.
    expect(screen.getAllByText('0:00 / 0:03')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Playback speed' })).toBeTruthy();
    // Timeline
    expect(screen.getByRole('button', { name: 'Set loop in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set loop out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear loop' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeTruthy();
    // Status bar
    expect(screen.getByRole('button', { name: 'Map settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Swap' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Help' })).toBeTruthy();
    expect(screen.getByText('0:03 duration')).toBeTruthy();
    expect(screen.getByText('SRT telemetry loaded')).toBeTruthy();
  });

  it('opens help from the status bar', () => {
    const onHelp = vi.fn();
    render(
      <Chrome
        session={SESSION}
        settings={SETTINGS}
        onSettingsChange={() => {}}
        onOpen={() => {}}
        onHelp={onHelp}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  it('loads the recording and gates playback on tile warm-up', async () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const warmup = screen.getByRole<HTMLButtonElement>('button', { name: 'Warming tiles…' });
    expect(warmup.disabled).toBe(true);
    await waitFor(() => {
      const play = screen.getByRole<HTMLButtonElement>('button', { name: 'Play' });
      expect(play.disabled).toBe(false);
    });
  });

  it('shows the video and the flight map side by side by default', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Swap' })).toBeTruthy();
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toBe('/video');
    const card = document.querySelector('.map-card') as HTMLElement;
    expect(card.className).toContain('map-card-split');
    expect(card.className).not.toContain('map-card-overlay');
  });

  it('shows the playback state and position in the preview strip', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const state = document.querySelector('.preview-state') as HTMLElement;
    expect(state.textContent).toBe('Paused at 0:00');
    expect(screen.getByText('Video + map')).toBeTruthy();
    expect(screen.getByText('Timeline')).toBeTruthy();
    expect(screen.queryByText('Playback & loop points')).toBeNull();
  });

  it('collects the speed buttons in one labeled group', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const group = screen.getByRole('group', { name: 'Playback speed' });
    const rates = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(rates).toEqual(['1×', '2×', '3×', '4×']);
    const titles = within(group)
      .getAllByRole('button')
      .map((b) => b.getAttribute('title'));
    expect(titles).toEqual([
      'Playback speed 1× (1)',
      'Playback speed 2× (2)',
      'Playback speed 3× (3)',
      'Playback speed 4× (4)',
    ]);
  });

  it('applies the frame the driver already reached when the scene arrives', async () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    await waitFor(() => expect(fakeScene.setFrame).toHaveBeenCalledWith(0));
  });

  it('seeks the video into the target frame span and repaints the scene when scrubbing', async () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    // jsdom's media element ignores currentTime writes; track them instead.
    let currentTime = 0;
    Object.defineProperty(video, 'currentTime', {
      get: () => currentTime,
      set: (v: number) => {
        currentTime = v;
      },
      configurable: true,
    });
    const scrub = document.querySelector('input[type="range"]');
    fireEvent.change(scrub as HTMLInputElement, { target: { value: '30' } });
    act(() => flushRaf());
    expect(currentTime).toBeCloseTo(30.5 / 30);
    await waitFor(() => expect(fakeScene.setFrame).toHaveBeenCalledWith(30));
    // The imperative readouts follow the presented frame.
    expect(document.querySelector('.preview-state')?.textContent).toBe('Paused at 0:01');
    expect(screen.getAllByText('0:01 / 0:03')).toHaveLength(2);
    expect(document.querySelector('.map-card .readout')?.textContent).toBe('0:01 / 0:03');
  });
});

describe('PlayerChrome view swap', () => {
  it('switches between the split panes and the overlay layout and back', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const card = document.querySelector('.map-card') as HTMLElement;
    expect(card.className).toContain('map-card-split');
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    expect(card.className).toContain('map-card-overlay');
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    expect(card.className).toContain('map-card-split');
  });

  it('keeps the map island mounted across the swap, so playback stays synchronized', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const island = screen.getByTestId('map-island');
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    expect(screen.getByTestId('map-island')).toBe(island);
  });

  it('does not swap views when the map card is clicked', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const card = document.querySelector('.map-card') as HTMLElement;
    fireEvent.click(card);
    expect(card.className).toContain('map-card-split');
  });
});

describe('PlayerChrome map appearance popover', () => {
  it('opens from the footer button and closes with Escape', async () => {
    const user = userEvent.setup();
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Map settings' });
    await user.click(toggle);
    expect(screen.getByRole('dialog', { name: 'Map appearance' })).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on a second toggle press instead of flapping open', async () => {
    const user = userEvent.setup();
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const toggle = screen.getByRole('button', { name: 'Map settings' });
    await user.click(toggle);
    expect(screen.getByRole('dialog', { name: 'Map appearance' })).toBeTruthy();
    await user.click(toggle);
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('applies settings changes from the popover', () => {
    const onSettingsChange = vi.fn();
    render(
      <Chrome
        session={SESSION}
        settings={SETTINGS}
        onSettingsChange={onSettingsChange}
        onOpen={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    fireEvent.change(screen.getByLabelText('Map style'), { target: { value: 'topo' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ style: 'topo' }),
    );
  });
});

interface FakePlayback {
  state: { paused: boolean; ended: boolean; currentTime: number; playbackRate: number };
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

// jsdom's media element ignores playback; this models play/pause/seek state
// so keyboard behavior stays observable.
function stubPlayback(): FakePlayback {
  const video = document.querySelector('video') as HTMLVideoElement;
  const state = { paused: true, ended: false, currentTime: 0, playbackRate: 1 };
  const play = vi.fn(() => {
    state.paused = false;
    state.ended = false;
    return Promise.resolve();
  });
  const pause = vi.fn(() => {
    state.paused = true;
  });
  vi.spyOn(video, 'play').mockImplementation(play);
  vi.spyOn(video, 'pause').mockImplementation(pause);
  Object.defineProperty(video, 'paused', { get: () => state.paused, configurable: true });
  Object.defineProperty(video, 'ended', { get: () => state.ended, configurable: true });
  Object.defineProperty(video, 'currentTime', {
    get: () => state.currentTime,
    set: (v: number) => {
      state.currentTime = v;
    },
    configurable: true,
  });
  Object.defineProperty(video, 'playbackRate', {
    get: () => state.playbackRate,
    set: (v: number) => {
      state.playbackRate = v;
    },
    configurable: true,
  });
  return { state, play, pause };
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.repeat) Object.defineProperty(event, 'repeat', { value: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function renderPlayer(onOpen: () => void = () => {}): Promise<FakePlayback> {
  render(
    <Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={onOpen} />,
  );
  await waitFor(() => {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Play' }).disabled).toBe(false);
  });
  return stubPlayback();
}

function setLoopRegion(from: number, to: number): void {
  const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
  fireEvent.change(scrub, { target: { value: String(from) } });
  key(window, { key: 'i' });
  fireEvent.change(scrub, { target: { value: String(to) } });
  key(window, { key: 'o' });
  act(() => flushRaf());
}

describe('PlayerChrome keyboard shortcuts', () => {
  it('toggles playback with Space and claims the key', async () => {
    const fake = await renderPlayer();
    const event = key(window, { key: ' ' });
    expect(fake.play).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    key(window, { key: ' ' });
    expect(fake.pause).toHaveBeenCalledTimes(1);
  });

  it('does not toggle playback while Space auto-repeats', async () => {
    const fake = await renderPlayer();
    key(window, { key: ' ', repeat: true });
    expect(fake.play).not.toHaveBeenCalled();
  });

  it('gates keyboard play on tile warm-up', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const fake = stubPlayback();
    key(window, { key: ' ' });
    expect(fake.play).not.toHaveBeenCalled();
  });

  it('sets playback speed from the number keys and the speed buttons', async () => {
    const fake = await renderPlayer();
    key(window, { key: '3' });
    expect(fake.state.playbackRate).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: '2×' }));
    expect(fake.state.playbackRate).toBe(2);
    expect(screen.getByRole('button', { name: '2×' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '3×' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('steps a frame and parks playback with the arrows', async () => {
    const fake = await renderPlayer();
    key(window, { key: ' ' });
    key(window, { key: 'ArrowRight' });
    expect(fake.pause).toHaveBeenCalledTimes(1);
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(1.5 / 30);
    key(window, { key: 'ArrowLeft' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(0.5 / 30);
  });

  it('claims keys that land before the post-commit effect flush', async () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const fake = stubPlayback();
    const warmup = screen.getByRole<HTMLButtonElement>('button', { name: 'Warming tiles…' });
    // The enabling commit's MutationObserver microtask runs before that
    // commit's passive effects — the window where a stale handler swallowed
    // keys (#62).
    const pressed = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (warmup.disabled) return;
        observer.disconnect();
        key(window, { key: ' ' });
        key(window, { key: 'ArrowRight' });
        resolve();
      });
      observer.observe(warmup, { attributes: true, attributeFilter: ['disabled'] });
    });
    await pressed;
    expect(fake.play).toHaveBeenCalledTimes(1);
    expect(fake.pause).toHaveBeenCalledTimes(1);
  });

  it('stacks rapid steps onto the head frame', async () => {
    const fake = await renderPlayer();
    key(window, { key: 'ArrowRight' });
    key(window, { key: 'ArrowRight' });
    key(window, { key: 'ArrowRight' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(3.5 / 30);
  });

  it('clamps stepping at the frame range', async () => {
    const fake = await renderPlayer();
    key(window, { key: 'ArrowLeft' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(0.5 / 30);
    key(window, { key: 'End' });
    key(window, { key: 'ArrowRight' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(89.5 / 30);
  });

  it('jumps one second with shift+arrows, frame-quantized', async () => {
    const fake = await renderPlayer();
    key(window, { key: 'ArrowRight', shiftKey: true });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(30.5 / 30);
    key(window, { key: 'ArrowLeft', shiftKey: true });
    key(window, { key: 'ArrowLeft', shiftKey: true });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(0.5 / 30);
  });

  it('jumps to start and end with Home and End', async () => {
    const fake = await renderPlayer();
    key(window, { key: 'End' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(89.5 / 30);
    key(window, { key: 'Home' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(0.5 / 30);
  });

  it('leaves native arrow stepping to the focused scrubber', async () => {
    const fake = await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    const event = key(scrub, { key: 'ArrowRight' });
    expect(event.defaultPrevented).toBe(false);
    expect(fake.state.currentTime).toBe(0);
  });

  it('leaves unclaimed keys to their default behavior', async () => {
    await renderPlayer();
    const event = key(window, { key: 'x' });
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens the recording dialog with Ctrl+O and leaves O to the loop', async () => {
    const onOpen = vi.fn();
    await renderPlayer(onOpen);
    key(window, { key: 'o', ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
    key(window, { key: 'o' });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText('loop ?–0:00')).toBeTruthy();
    // Ctrl+O still fires while the scrubber has focus.
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    key(scrub, { key: 'o', ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('swaps the layout with S', async () => {
    await renderPlayer();
    const card = document.querySelector('.map-card') as HTMLElement;
    key(window, { key: 's' });
    expect(card.className).toContain('map-card-overlay');
  });
});

describe('PlayerChrome loop region', () => {
  it('sets the loop with I and O, shows the region, and wraps playback into it', async () => {
    const fake = await renderPlayer();
    setLoopRegion(30, 60);
    expect(document.querySelector('.loop-readout')?.textContent).toBe('loop 0:01–0:02');
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((30 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo((30 / 89) * 100);
    fake.state.paused = false;
    fake.state.currentTime = 70 / 30;
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(30.5 / 30);
    await waitFor(() => expect(fakeScene.setFrame).toHaveBeenCalledWith(30));
  });

  it('closes the popover on Esc first and clears the loop on the second', async () => {
    await renderPlayer();
    setLoopRegion(30, 60);
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    expect(document.querySelector('.loop-readout')?.textContent).toBe('loop 0:01–0:02');
    key(window, { key: 'Escape' });
    expect(document.querySelector('.loop-readout')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Clear loop' }).disabled).toBe(true);
  });

  it('clears the loop from the Clear button', async () => {
    await renderPlayer();
    setLoopRegion(30, 60);
    fireEvent.click(screen.getByRole('button', { name: 'Clear loop' }));
    expect(document.querySelector('.loop-readout')).toBeNull();
  });

  it('states why Clear is disabled without a loop', async () => {
    await renderPlayer();
    const clear = screen.getByRole<HTMLButtonElement>('button', { name: 'Clear loop' });
    expect(clear.disabled).toBe(true);
    expect(clear.getAttribute('title')).toBe('No loop to clear.');
    setLoopRegion(30, 60);
    expect(clear.getAttribute('title')).toBe('Clear loop (Esc)');
  });

  it('shows no region for an out-of-order loop', async () => {
    await renderPlayer();
    setLoopRegion(60, 30);
    expect(document.querySelector('.loop-band')).toBeNull();
    expect(document.querySelector('.loop-readout')?.textContent).toBe('loop 0:02–0:01');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Clear loop' }).disabled).toBe(false);
  });

  it('resumes an end-of-file loop at the loop start, not the file start', async () => {
    const fake = await renderPlayer();
    setLoopRegion(30, 60);
    fake.state.ended = true;
    fake.state.paused = true;
    key(window, { key: ' ' });
    expect(fake.play).toHaveBeenCalledTimes(1);
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(30.5 / 30);
  });
});

describe('PlayerChrome shortcut guard rails', () => {
  it('keeps player keys inert while a dialog is open', async () => {
    const onOpen = vi.fn();
    const fake = await renderPlayer(onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    key(window, { key: ' ' });
    key(window, { key: '2' });
    key(window, { key: 'ArrowRight' });
    key(window, { key: 'o', ctrlKey: true });
    expect(fake.play).not.toHaveBeenCalled();
    expect(fake.state.playbackRate).toBe(1);
    expect(fake.state.currentTime).toBe(0);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keeps player keys inert while typing in a popover field', async () => {
    const onOpen = vi.fn();
    const fake = await renderPlayer(onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    const field = document.querySelector('input[type="number"]') as HTMLInputElement;
    key(field, { key: '3' });
    key(field, { key: ' ' });
    expect(fake.state.playbackRate).toBe(1);
    expect(fake.play).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    // Ctrl+O stays available while typing, as everywhere else.
    key(field, { key: 'o', ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps player keys live while the popover is open', async () => {
    const fake = await renderPlayer();
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    key(window, { key: ' ' });
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it('leaves Esc on an open select dropdown to the select', async () => {
    await renderPlayer();
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    const select = document.querySelector('select') as HTMLSelectElement;
    key(select, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Map appearance' })).toBeTruthy();
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
  });
});

describe('PlayerChrome flight stats strip', () => {
  it('renders no telemetry chips over the player', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('.stats')).toBeNull();
    expect(screen.queryByText(/^(Duration|Track|Heading:)/)).toBeNull();
    expect(screen.queryByText(/no-lock cues/)).toBeNull();
  });
});

describe('PlayerChrome open notice', () => {
  it('reports a failed Open inside the player and keeps the recording on screen', () => {
    const onDismiss = vi.fn();
    render(
      <Chrome
        session={SESSION}
        settings={SETTINGS}
        onSettingsChange={() => {}}
        onOpen={() => {}}
        openState={{ kind: 'error', message: 'not a readable .mp4 file: C:\\Windows\\win.ini' }}
        onDismissOpenState={onDismiss}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('"win.ini" is not a readable .mp4 recording.');
    expect(document.querySelector('.workspace')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows the preparing status over the player and holds Open until the file is ready', () => {
    render(
      <Chrome
        session={SESSION}
        settings={SETTINGS}
        onSettingsChange={() => {}}
        onOpen={() => {}}
        openState={{ kind: 'preparing', progress: START_PREPARE_PROGRESS }}
      />,
    );
    expect(screen.getByText('Probing the recording…')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Preparation progress' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' }).disabled).toBe(true);
  });
});

describe.each<PickState>([{ kind: 'idle' }, { kind: 'picking' }, { kind: 'canceled' }, { kind: 'ready' }])(
  'PlayerChrome with the $kind open state',
  (openState) => {
    it('shows no notice and keeps Open available', () => {
      render(
        <Chrome
          session={SESSION}
          settings={SETTINGS}
          onSettingsChange={() => {}}
          onOpen={() => {}}
          openState={openState}
        />,
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' }).disabled).toBe(false);
    });
  },
);
