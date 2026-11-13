// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import type { Scene } from '../../src/renderer/scene.js';
import { PlayerChrome } from '../../ui/components/PlayerChrome.js';
import type { PlayerChromeProps } from '../../ui/components/PlayerChrome.js';
import { useDialogs } from '../../ui/hooks/useDialogs.js';
import { START_PREPARE_PROGRESS } from '../../ui/lib/pickstate.js';
import type { PickState } from '../../ui/lib/pickstate.js';
import { SESSION, flushRaf, installRafStub } from './harness.js';

const fakeScene = vi.hoisted((): Scene => ({
  setFrame: vi.fn(() => Promise.resolve()),
  relayout: vi.fn(),
  update: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
  dispose: vi.fn(),
}));

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { delayedMapIslandMock } = await import('./harness.js');
  return delayedMapIslandMock(fakeScene);
});

vi.mock('../../ui/components/ExportPreview.js', async () => {
  const { stubExportPreviewMock } = await import('./harness.js');
  return stubExportPreviewMock();
});

const SETTINGS: RenderConfig = { ...DEFAULT_CONFIG };

function Chrome({
  onHelp = () => {},
  onExit = () => {},
  ...props
}: Omit<PlayerChromeProps, 'dialogs' | 'onHelp' | 'onExit'> & {
  onHelp?: () => void;
  onExit?: () => void;
}) {
  const dialogs = useDialogs();
  return <PlayerChrome {...props} onHelp={onHelp} onExit={onExit} dialogs={dialogs} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  installRafStub();
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

    clickMenuItem('Export video…');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /In–Out segment/ }).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '1024' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    clickMenuItem('Export video…');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /In–Out segment/ }).checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Width').value).toBe('1024');
  });
});

describe('PlayerChrome workspace structure', () => {
  it('keeps the menu, transport, timeline and status bar actions reachable', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    openMenu('File');
    for (const name of ['Open…', 'Export video…', 'Export telemetry…', 'Settings', 'Exit']) {
      expect(within(menuBar()).getByRole('menuitem', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Jump to start' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Jump to end' })).toBeTruthy();
    expect(screen.getAllByText('0:00 / 0:03')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Playback speed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set loop in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set loop out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear loop' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeTruthy();
    expect(screen.getByText('SRT telemetry loaded')).toBeTruthy();
    // The moved commands live in the menu bar only.
    expect(document.querySelectorAll('.workspace-header button')).toHaveLength(0);
    expect(document.querySelectorAll('.status-bar button')).toHaveLength(0);
  });

  it('keeps the transport row after the stage row, so it can mirror the stage layout', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const stage = document.querySelector('.stage') as HTMLElement;
    expect(stage.parentElement?.className).toBe('workspace');
    expect(stage.nextElementSibling).toBe(document.querySelector('.transport'));
  });

  it('opens help from the Help menu', () => {
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
    clickMenuItem('Documentation');
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  it('opens About from the Help menu', () => {
    const dispatchDialog = vi.fn();
    render(
      <PlayerChrome
        session={SESSION}
        settings={SETTINGS}
        onSettingsChange={() => {}}
        onOpen={() => {}}
        onHelp={() => {}}
        onExit={() => {}}
        dialogs={{
          modalOpen: false,
          helpOpen: false,
          aboutOpen: false,
          exportOpen: false,
          telemetrySaveOpen: false,
          updateOpen: false,
          dismissible: true,
          dispatchDialog,
        }}
      />,
    );
    clickMenuItem('About');
    expect(dispatchDialog).toHaveBeenCalledWith({ type: 'openAbout' });
  });

  it('gates playback until the scene is ready', async () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const play = screen.getByRole<HTMLButtonElement>('button', { name: 'Play' });
    expect(play.disabled).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Play' }).disabled).toBe(false);
    });
  });

  it('shows the video and the flight map side by side by default', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    openMenu('View');
    expect(within(menuBar()).getByRole('menuitem', { name: 'Swap' })).toBeTruthy();
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toBe('/video');
    const card = document.querySelector('.map-card') as HTMLElement;
    expect(card.className).toContain('map-card-split');
    expect(card.className).not.toContain('map-card-overlay');
  });

  it('shows no preview strip over the stage (#157)', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('.preview-strip')).toBeNull();
    expect(screen.queryByText('Video + map')).toBeNull();
    expect(screen.queryByText(/^Paused at|^Playing at/)).toBeNull();
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
    expect(document.querySelector('.transport .readout')?.textContent).toBe('0:01 / 0:03');
  });
});

describe('PlayerChrome view swap', () => {
  it('switches between the split panes and the overlay layout and back', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const card = document.querySelector('.map-card') as HTMLElement;
    expect(card.className).toContain('map-card-split');
    clickMenuItem('Swap');
    expect(card.className).toContain('map-card-overlay');
    clickMenuItem('Swap');
    expect(card.className).toContain('map-card-split');
  });

  it('flips the stage layout class the transport mirrors', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const stage = document.querySelector('.stage') as HTMLElement;
    expect(stage.className).toContain('stage-split');
    clickMenuItem('Swap');
    expect(stage.className).toContain('stage-overlay');
    clickMenuItem('Swap');
    expect(stage.className).toContain('stage-split');
  });

  it('keeps the map island mounted across the swap, so playback stays synchronized', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const island = screen.getByTestId('map-island');
    clickMenuItem('Swap');
    clickMenuItem('Swap');
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
  it('opens from the File menu and closes with Escape', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    clickMenuItem('Settings');
    expect(screen.getByRole('dialog', { name: 'Map appearance' })).toBeTruthy();
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
  });

  it('closes on a second Settings run instead of flapping open', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    clickMenuItem('Settings');
    expect(screen.getByRole('dialog', { name: 'Map appearance' })).toBeTruthy();
    clickMenuItem('Settings');
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    // Menu actions return focus to their menu's label, the home of the item.
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'File' }));
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
    clickMenuItem('Settings');
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

function menuBar(): HTMLElement {
  return document.querySelector('.menu-bar') as HTMLElement;
}

const MENU_OF_ITEM: Record<string, 'File' | 'View' | 'Help'> = {
  'Open…': 'File',
  'Export video…': 'File',
  'Export telemetry…': 'File',
  Settings: 'File',
  Exit: 'File',
  Swap: 'View',
  Documentation: 'Help',
  About: 'Help',
};

function openMenu(label: 'File' | 'View' | 'Help'): void {
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

function clickMenuItem(label: string): void {
  openMenu(MENU_OF_ITEM[label]);
  fireEvent.click(within(menuBar()).getByRole('menuitem', { name: label }));
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

  it('gates keyboard play until the scene is ready', () => {
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
    const play = screen.getByRole<HTMLButtonElement>('button', { name: 'Play' });
    const pressed = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (play.disabled) return;
        observer.disconnect();
        key(window, { key: ' ' });
        key(window, { key: 'ArrowRight' });
        resolve();
      });
      observer.observe(play, { attributes: true, attributeFilter: ['disabled'] });
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

  it('steps a frame with the arrows while the scrubber holds focus (#157)', async () => {
    const fake = await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    const event = key(scrub, { key: 'ArrowRight' });
    expect(event.defaultPrevented).toBe(true);
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(1.5 / 30);
  });

  it('sets the loop points with I and O while the scrubber holds focus (#157)', async () => {
    await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(document.querySelector('.loop-band')).toBeNull();
    key(scrub, { key: 'i' });
    key(scrub, { key: 'ArrowRight' });
    key(scrub, { key: 'o' });
    expect(document.querySelector('.loop-band')).toBeTruthy();
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
    expect(screen.getByText('loop …–0:00')).toBeTruthy();
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
    clickMenuItem('Settings');
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    expect(document.querySelector('.loop-readout')?.textContent).toBe('loop 0:01–0:02');
    key(window, { key: 'Escape' });
    expect(document.querySelector('.loop-readout')?.textContent).toBe('');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Clear loop' }).disabled).toBe(true);
  });

  it('clears the loop from the Clear button', async () => {
    await renderPlayer();
    setLoopRegion(30, 60);
    fireEvent.click(screen.getByRole('button', { name: 'Clear loop' }));
    expect(document.querySelector('.loop-readout')?.textContent).toBe('');
  });

  it('pins the readout slot left of the loop controls at the right edge (#233)', async () => {
    await renderPlayer();
    setLoopRegion(30, 60);
    const actions = document.querySelector('.timeline-actions') as HTMLElement;
    expect([...actions.children].map((child) => child.className)).toEqual([
      'readout loop-readout',
      'segmented',
    ]);
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
    clickMenuItem('Export video…');
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
    clickMenuItem('Settings');
    const field = document.querySelector('input[type="number"]') as HTMLInputElement;
    key(field, { key: '3' });
    key(field, { key: ' ' });
    expect(fake.state.playbackRate).toBe(1);
    expect(fake.play).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    key(field, { key: 'o', ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps player keys live while the popover is open', async () => {
    const fake = await renderPlayer();
    clickMenuItem('Settings');
    key(window, { key: ' ' });
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it('leaves Esc on an open select dropdown to the select', async () => {
    await renderPlayer();
    clickMenuItem('Settings');
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
    openMenu('File');
    expect(
      within(menuBar()).getByRole('menuitem', { name: 'Open…' }).getAttribute('aria-disabled'),
    ).toBe('true');
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
      openMenu('File');
      expect(
        within(menuBar()).getByRole('menuitem', { name: 'Open…' }).getAttribute('aria-disabled'),
      ).toBeNull();
    });
  },
);

describe('PlayerChrome export telemetry', () => {
  afterEach(() => {
    delete (window as { dronepath?: unknown }).dronepath;
  });

  function installTelemetryBridge(overrides: Record<string, unknown> = {}) {
    const bridge = {
      pickTelemetryOutput: vi.fn(async () => ({ ok: true, path: '/exports/flight.telemetry.json' })),
      saveTelemetryJson: vi.fn(async () => ({ ok: true })),
      revealExportOutput: vi.fn(async () => ({ ok: true })),
      ...overrides,
    };
    (window as { dronepath?: unknown }).dronepath = bridge;
    return bridge;
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  it('starts nothing when the save dialog is canceled', async () => {
    const bridge = installTelemetryBridge({
      pickTelemetryOutput: vi.fn(async () => ({ ok: false, canceled: true })),
    });
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    clickMenuItem('Export telemetry…');
    await settle();

    expect(bridge.saveTelemetryJson).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the error dialog when the pick fails, so the failure is never silent', async () => {
    const bridge = installTelemetryBridge({
      pickTelemetryOutput: vi.fn(async () => ({ ok: false, error: 'the dialog went away' })),
    });
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    clickMenuItem('Export telemetry…');
    await settle();

    expect(bridge.saveTelemetryJson).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Export telemetry' })).toBeTruthy();
    expect(screen.getByText('the dialog went away')).toBeTruthy();
  });

  it('keeps the dialog up during the write and surfaces a late failure', async () => {
    let finish = null as ((ack: { ok: boolean; error?: string }) => void) | null;
    installTelemetryBridge({
      saveTelemetryJson: vi.fn(
        () =>
          new Promise<{ ok: boolean; error?: string }>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    clickMenuItem('Export telemetry…');
    await settle();
    expect(screen.getByText('Exporting telemetry…')).toBeTruthy();

    key(window, { key: 'Escape' });
    await settle();
    expect(screen.getByRole('dialog', { name: 'Export telemetry' })).toBeTruthy();

    if (finish) finish({ ok: false, error: 'disk full' });
    await settle();
    expect(screen.getByText('disk full')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Export telemetry' })).toBeTruthy();
  });

  it('reports the scope captured at save time, not a later loop edit', async () => {
    let finish = null as ((ack: { ok: boolean; error?: string }) => void) | null;
    installTelemetryBridge({
      saveTelemetryJson: vi.fn(
        () =>
          new Promise<{ ok: boolean; error?: string }>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    await renderPlayer();
    setLoopRegion(10, 60);
    clickMenuItem('Export telemetry…');
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Clear loop' }));
    if (finish) finish({ ok: true });
    await settle();
    expect(screen.getByText('Scope: In–Out segment (0:00–0:02 · 51 frames)')).toBeTruthy();
  });
});
