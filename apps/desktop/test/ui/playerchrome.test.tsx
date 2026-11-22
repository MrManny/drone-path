// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import type { RenderConfig } from 'drone-path-engine/config';
import { restyleSceneData } from 'drone-path-engine/restyle';
import type { Scene } from 'drone-path-engine/renderer/scene';
import { ModalHost } from '../../ui/components/ModalHost.js';
import { PlayerChrome } from '../../ui/components/PlayerChrome.js';
import type { PlayerChromeProps } from '../../ui/components/PlayerChrome.js';
import { useAppModals } from '../../ui/hooks/useAppModals.js';
import type { LoopState } from '../../ui/lib/loop.js';
import { INITIAL_PREPARE_PROGRESS } from 'drone-path-engine/plan';
import type { PickState } from '../../ui/lib/pickstate.js';
import { restyleMeta } from '../../ui/lib/restylemeta.js';
import { SESSION, flushRaf, installRafStub, installResizeObserverStub } from './harness.js';

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

vi.mock('drone-path-engine/renderer/boot', () => ({
  bootScene: (): Scene => ({
    setFrame: vi.fn(() => Promise.resolve()),
    relayout: vi.fn(),
    update: vi.fn(() => Promise.resolve()),
    ready: Promise.resolve(),
    dispose: vi.fn(),
  }),
}));

vi.mock('leaflet', () => ({ default: {} }));

vi.mock('../../ui/components/ExportPreview.js', async () => {
  const { stubExportPreviewMock } = await import('./harness.js');
  return stubExportPreviewMock();
});

const SETTINGS: RenderConfig = { ...DEFAULT_CONFIG };

const NOOP_LANGUAGE = {
  locale: 'en' as const,
  preference: null,
  saving: false,
  error: false,
  selectLanguage: () => {},
};

function Chrome({
  onHelp = () => {},
  onExit = () => {},
  ...props
}: Omit<PlayerChromeProps, 'dialogs' | 'onHelp' | 'onExit'> & {
  onHelp?: () => void;
  onExit?: () => void;
}) {
  const [loop, setLoop] = useState<LoopState>({ in: null, out: null });
  const modals = useAppModals();
  return (
    <>
      <PlayerChrome
        {...props}
        onHelp={onHelp}
        onExit={onExit}
        dialogs={modals.dialogs}
        loopControl={[loop, setLoop]}
        onExportVideo={() =>
          modals.openExport(props.settings, loop, props.session.video.frames)
        }
        onExportTelemetry={modals.openTrackSave}
      />
      <ModalHost
        modals={modals}
        session={props.session}
        settings={props.settings}
        loop={loop}
        onSettingsChange={props.onSettingsChange}
        language={NOOP_LANGUAGE}
      />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installRafStub();
  installResizeObserverStub();
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
    fireEvent.click(screen.getByRole('button', { name: 'Set in point' }));
    fireEvent.change(scrub, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set out point' }));

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
  it.for(['loadedData', 'error'] as const)('clears the video status on %s', (event) => {
    const { container } = render(
      <Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />,
    );
    const pane = container.querySelector<HTMLElement>('.pane-video')!;
    expect(within(pane).getByRole('status').textContent).toBe('Preparing video…');
    fireEvent[event](pane.querySelector('video')!);
    expect(within(pane).queryByRole('status')).toBeNull();
  });

  it('does not bring back the first-frame status when playback stalls and pauses', () => {
    const { container } = render(
      <Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />,
    );
    const pane = container.querySelector<HTMLElement>('.pane-video')!;
    const video = pane.querySelector('video')!;
    const paused = vi.spyOn(video, 'paused', 'get').mockReturnValue(false);
    fireEvent.loadedData(video);
    fireEvent.play(video);
    fireEvent.waiting(video);
    expect(within(pane).queryByRole('status')).toBeNull();

    paused.mockReturnValue(true);
    fireEvent.pause(video);
    expect(within(pane).queryByRole('status')).toBeNull();
  });

  it('keeps the menu, transport and timeline actions reachable', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    openMenu('File');
    for (const name of ['Open…', 'Export video…', 'Export telemetry…', 'Exit']) {
      expect(within(menuBar()).getByRole('menuitem', { name })).toBeTruthy();
    }
    openMenu('View');
    for (const name of ['Map appearance…', 'Picture in picture']) {
      expect(within(menuBar()).getByRole('menuitem', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Jump to start' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Jump to end' })).toBeTruthy();
    expect(screen.getAllByText('0:00 / 0:03')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Playback speed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set in point' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set out point' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear in and out points' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeTruthy();
    expect(document.querySelector('.status-bar')).toBeNull();
    // The moved commands live in the menu bar only.
    expect(document.querySelectorAll('.workspace-header button')).toHaveLength(0);
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
    clickMenuItem('User manual');
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
          active: 'closed',
          modalOpen: false,
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
    expect(within(menuBar()).getByRole('menuitem', { name: 'Picture in picture' })).toBeTruthy();
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
      'Playback speed 1× (key 1)',
      'Playback speed 2× (key 2)',
      'Playback speed 3× (key 3)',
      'Playback speed 4× (key 4)',
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
    clickMenuItem('Picture in picture');
    expect(card.className).toContain('map-card-overlay');
    clickMenuItem('Picture in picture');
    expect(card.className).toContain('map-card-split');
  });

  it('flips the stage layout class the transport mirrors', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const stage = document.querySelector('.stage') as HTMLElement;
    expect(stage.className).toContain('stage-split');
    clickMenuItem('Picture in picture');
    expect(stage.className).toContain('stage-overlay');
    clickMenuItem('Picture in picture');
    expect(stage.className).toContain('stage-split');
  });

  it('keeps the map island mounted across the swap, so playback stays synchronized', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const island = screen.getByTestId('map-island');
    clickMenuItem('Picture in picture');
    clickMenuItem('Picture in picture');
    expect(screen.getByTestId('map-island')).toBe(island);
  });

  it('does not swap views when the map card is clicked', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const card = document.querySelector('.map-card') as HTMLElement;
    fireEvent.click(card);
    expect(card.className).toContain('map-card-split');
  });
});

describe('PlayerChrome map appearance dialog', () => {
  it('opens from the View menu and closes with Escape', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    clickMenuItem('Map appearance…');
    const dialog = screen.getByRole('dialog', { name: 'Map appearance' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
  });

  it('closes on a second Map appearance… run instead of flapping open', () => {
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    clickMenuItem('Map appearance…');
    expect(screen.getByRole('dialog', { name: 'Map appearance' })).toBeTruthy();
    clickMenuItem('Map appearance…');
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    // Menu actions return focus to their menu's label, the home of the item.
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'View' }));
  });

  it('applies settings changes from the dialog', () => {
    const onSettingsChange = vi.fn();
    render(
      <Chrome
        session={SESSION}
        settings={SETTINGS}
        onSettingsChange={onSettingsChange}
        onOpen={() => {}}
      />,
    );
    clickMenuItem('Map appearance…');
    fireEvent.click(screen.getByRole('button', { name: 'Topographic' }));
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

function pointer(type: string, target: EventTarget, init: MouseEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

function menuBar(): HTMLElement {
  return document.querySelector('.menu-bar') as HTMLElement;
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

function openMenu(label: 'File' | 'View' | 'Help'): void {
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

function clickMenuItem(label: string): void {
  openMenu(MENU_OF_ITEM[label]);
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }));
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
    expect(screen.getByText('in 0:00 · out 0:00')).toBeTruthy();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    key(scrub, { key: 'o', ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('swaps the layout with S', async () => {
    await renderPlayer();
    const card = document.querySelector('.map-card') as HTMLElement;
    key(window, { key: 'p' });
    expect(card.className).toContain('map-card-overlay');
  });
});

describe('PlayerChrome map zoom (#270)', () => {
  function plannedZoom(settings: RenderConfig): number {
    const { style, trailColor, view, zoom, zoomOut, introSec, outroSec, hud } = settings;
    return restyleSceneData(
      SESSION.scene,
      { style, trailColor, view, zoom, zoomOut, introSec, outroSec, hud },
      restyleMeta(SESSION),
    ).zoom;
  }

  function renderZoom(settings: RenderConfig) {
    const onSettingsChange = vi.fn();
    render(
      <Chrome
        session={SESSION}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onOpen={() => {}}
      />,
    );
    return onSettingsChange;
  }

  it('pins one zoom level per stepper press', () => {
    const onSettingsChange = renderZoom({ ...SETTINGS, zoom: 14 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onSettingsChange).toHaveBeenNthCalledWith(1, { ...SETTINGS, zoom: 15 });
    expect(onSettingsChange).toHaveBeenNthCalledWith(2, { ...SETTINGS, zoom: 13 });
  });

  it('resolves auto-fit to the visible level on the first press', () => {
    const onSettingsChange = renderZoom(SETTINGS);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...SETTINGS,
      zoom: plannedZoom(SETTINGS) + 1,
    });
  });

  it('keeps the stepper readout and the zoom setting in sync', () => {
    renderZoom({ ...SETTINGS, zoom: 14 });
    expect(screen.getByText('14')).toBeTruthy();
    clickMenuItem('Map appearance…');
    expect(screen.getByRole<HTMLInputElement>('slider', { name: 'Zoom level' }).value).toBe('14');
  });

  it('reads auto-fit in the stepper while the zoom is auto-fit', () => {
    renderZoom(SETTINGS);
    expect(screen.getByText('auto-fit')).toBeTruthy();
    clickMenuItem('Map appearance…');
    expect(
      (screen.getByRole<HTMLInputElement>('checkbox', { name: 'Auto-fit zoom' })).checked,
    ).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('slider', { name: 'Zoom level' }).disabled).toBe(true);
  });

  it('steps the zoom with the + and - keys and pins the level', () => {
    const onSettingsChange = renderZoom(SETTINGS);
    key(window, { key: '+' });
    key(window, { key: '-' });
    expect(onSettingsChange).toHaveBeenNthCalledWith(1, {
      ...SETTINGS,
      zoom: plannedZoom(SETTINGS) + 1,
    });
    expect(onSettingsChange).toHaveBeenNthCalledWith(2, {
      ...SETTINGS,
      zoom: plannedZoom(SETTINGS) - 1,
    });
  });

  it('leaves = and _ to their default behavior', () => {
    const onSettingsChange = renderZoom(SETTINGS);
    const eq = key(window, { key: '=' });
    const underscore = key(window, { key: '_', shiftKey: true });
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(eq.defaultPrevented).toBe(false);
    expect(underscore.defaultPrevented).toBe(false);
  });

  it('acts once per press and never on held-key repeats', () => {
    const onSettingsChange = renderZoom({ ...SETTINGS, zoom: 14 });
    key(window, { key: '+', repeat: true });
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('keeps the zoom keys inert while typing in a field', () => {
    const onSettingsChange = renderZoom({ ...SETTINGS, zoom: 14 });
    clickMenuItem('Map appearance…');
    key(screen.getByLabelText('Intro length'), { key: '+' });
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('keeps the zoom keys live in the PiP overlay', () => {
    const onSettingsChange = renderZoom({ ...SETTINGS, zoom: 14 });
    key(window, { key: 'p' });
    expect(screen.queryByRole('group', { name: 'Zoom level' })).toBeNull();
    key(window, { key: '+' });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...SETTINGS, zoom: 15 });
  });

  it('keeps the limit button focusable and states why (#271)', () => {
    renderZoom({ ...SETTINGS, zoom: 19 });
    const zoomIn = screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom in' });
    expect(zoomIn.getAttribute('aria-disabled')).toBe('true');
    expect(zoomIn.disabled).toBe(false);
    expect(zoomIn.getAttribute('title')).toBe('Already zoomed all the way in');
    expect(screen.getByText('19')).toBeTruthy();
  });

  it('states why zooming out is unavailable at the floor (#271)', () => {
    renderZoom({ ...SETTINGS, zoom: 2 });
    const zoomOut = screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom out' });
    expect(zoomOut.getAttribute('aria-disabled')).toBe('true');
    expect(zoomOut.disabled).toBe(false);
    expect(zoomOut.getAttribute('title')).toBe('Already zoomed all the way out');
  });

  it('announces why a refused keyboard step did nothing (#271)', () => {
    const onSettingsChange = renderZoom({ ...SETTINGS, zoom: 19 });
    const readout = document.querySelector('.map-zoom-level') as HTMLElement;
    key(window, { key: '+' });
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(readout.textContent).toBe('Zoom level 19. Already zoomed all the way in');
    key(window, { key: '-' });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...SETTINGS, zoom: 18 });
    expect(readout.textContent).toBe('Zoom level 19');
  });

  it('announces a refused stepper press at the limit (#271)', () => {
    const onSettingsChange = renderZoom({ ...SETTINGS, zoom: 19 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onSettingsChange).not.toHaveBeenCalled();
    const readout = document.querySelector('.map-zoom-level') as HTMLElement;
    expect(readout.textContent).toBe('Zoom level 19. Already zoomed all the way in');
  });

  it('keeps the zoom slider inside the usable range so the stepper cannot desync (#271)', () => {
    renderZoom({ ...SETTINGS, zoom: 14 });
    clickMenuItem('Map appearance…');
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Zoom level' });
    expect(slider.min).toBe('2');
    expect(slider.max).toBe('19');
    expect(slider.step).toBe('1');
  });

  it('moves the stepper readout when the dialog sets the level (#271)', () => {
    function ZoomChrome({ initial }: { initial: RenderConfig }) {
      const [settings, setSettings] = useState(initial);
      return (
        <Chrome
          session={SESSION}
          settings={settings}
          onSettingsChange={setSettings}
          onOpen={() => {}}
        />
      );
    }
    render(<ZoomChrome initial={{ ...SETTINGS, zoom: 14 }} />);
    const readout = () => document.querySelector('.map-zoom-level') as HTMLElement;
    clickMenuItem('Map appearance…');
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom level' }), { target: { value: '17' } });
    expect(readout().textContent).toBe('Zoom level 17');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(readout().textContent).toBe('Zoom level 18');
  });

  it('drops a stale refusal reason when the dialog moves the level (#271)', () => {
    function ZoomChrome({ initial }: { initial: RenderConfig }) {
      const [settings, setSettings] = useState(initial);
      return (
        <Chrome
          session={SESSION}
          settings={settings}
          onSettingsChange={setSettings}
          onOpen={() => {}}
        />
      );
    }
    render(<ZoomChrome initial={{ ...SETTINGS, zoom: 19 }} />);
    key(window, { key: '+' });
    const readout = () => document.querySelector('.map-zoom-level') as HTMLElement;
    expect(readout().textContent).toBe('Zoom level 19. Already zoomed all the way in');

    clickMenuItem('Map appearance…');
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom level' }), { target: { value: '14' } });
    expect(readout().textContent).toBe('Zoom level 14');
    expect(readout().textContent).not.toContain('Already zoomed');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-fit zoom' }));
    expect(readout().textContent).toBe('Zoom level auto-fit');
    expect(readout().textContent).not.toContain('Already zoomed');
  });
});

describe('PlayerChrome PiP zoom readout (#287)', () => {
  function PinnedChrome({ initial }: { initial: RenderConfig }) {
    const [settings, setSettings] = useState(initial);
    return (
      <Chrome
        session={SESSION}
        settings={settings}
        onSettingsChange={setSettings}
        onOpen={() => {}}
      />
    );
  }

  function zoomReadout(): HTMLElement {
    return document.querySelector('.map-zoom-level') as HTMLElement;
  }

  it('shows the zoom readout in the PiP strip while the stepper stays out', () => {
    render(<PinnedChrome initial={{ ...SETTINGS, zoom: 14 }} />);
    key(window, { key: 'p' });
    expect(screen.getByText('Zoom')).toBeTruthy();
    expect(zoomReadout().textContent).toBe('Zoom level 14');
    expect(screen.queryByRole('group', { name: 'Zoom level' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom out' })).toBeNull();
  });

  it('moves the PiP readout when a zoom key steps the map (#287 regression)', () => {
    render(<PinnedChrome initial={{ ...SETTINGS, zoom: 14 }} />);
    key(window, { key: 'p' });
    expect(zoomReadout().textContent).toBe('Zoom level 14');
    key(window, { key: '+' });
    expect(zoomReadout().textContent).toBe('Zoom level 15');
    key(window, { key: '-' });
    expect(zoomReadout().textContent).toBe('Zoom level 14');
  });

  it('announces a refused step through the mounted PiP live region (#287 regression)', () => {
    render(<PinnedChrome initial={{ ...SETTINGS, zoom: 19 }} />);
    key(window, { key: 'p' });
    expect(zoomReadout().textContent).toBe('Zoom level 19');
    key(window, { key: '+' });
    expect(zoomReadout().textContent).toBe('Zoom level 19. Already zoomed all the way in');
    key(window, { key: '-' });
    expect(zoomReadout().textContent).toBe('Zoom level 18');
  });
});

describe('PlayerChrome loop region', () => {
  it('sets the loop with I and O, shows the region, and wraps playback into it', async () => {
    const fake = await renderPlayer();
    setLoopRegion(30, 60);
    expect(document.querySelector('.loop-readout')?.textContent).toBe('in 0:01 · out 0:02');
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((30 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo((30 / 89) * 100);
    fake.state.paused = false;
    fake.state.currentTime = 70 / 30;
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(30.5 / 30);
    await waitFor(() => expect(fakeScene.setFrame).toHaveBeenCalledWith(30));
  });

  it('closes the dialog on Esc first and clears the loop on the second', async () => {
    await renderPlayer();
    setLoopRegion(30, 60);
    clickMenuItem('Map appearance…');
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Map appearance' })).toBeNull();
    expect(document.querySelector('.loop-readout')?.textContent).toBe('in 0:01 · out 0:02');
    key(window, { key: 'Escape' });
    expect(document.querySelector('.loop-readout')?.textContent).toBe('');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Clear in and out points' }).disabled).toBe(true);
  });

  it('clears the loop from the Clear button', async () => {
    await renderPlayer();
    setLoopRegion(30, 60);
    fireEvent.click(screen.getByRole('button', { name: 'Clear in and out points' }));
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
    const clear = screen.getByRole<HTMLButtonElement>('button', { name: 'Clear in and out points' });
    expect(clear.disabled).toBe(true);
    expect(clear.getAttribute('title')).toBe('No in or out point to clear');
    setLoopRegion(30, 60);
    expect(clear.getAttribute('title')).toBe('Clear in and out points (Esc)');
  });

  it('supersedes a stale out point when the in point lands past it (#245)', async () => {
    await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: '30' } });
    key(window, { key: 'o' });
    fireEvent.change(scrub, { target: { value: '60' } });
    key(window, { key: 'i' });
    act(() => flushRaf());
    expect(document.querySelector('.loop-readout')?.textContent).toBe('in 0:02 · out 0:03');
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((60 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo((29 / 89) * 100);
    const handles = document.querySelectorAll('.loop-handle');
    expect(handles).toHaveLength(1);
    expect(handles[0].className).toContain('loop-handle-in');
  });

  it('supersedes a stale in point when the out point lands before it (#245)', async () => {
    await renderPlayer();
    setLoopRegion(60, 30);
    expect(document.querySelector('.loop-readout')?.textContent).toBe('in 0:00 · out 0:01');
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo(0);
    expect(parseFloat(band.style.width)).toBeCloseTo((30 / 89) * 100);
    const handles = document.querySelectorAll('.loop-handle');
    expect(handles).toHaveLength(1);
    expect(handles[0].className).toContain('loop-handle-out');
  });

  it('shows a lone in point as a half-open band to the track end (#245)', async () => {
    await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: '30' } });
    key(window, { key: 'i' });
    act(() => flushRaf());
    expect(document.querySelector('.loop-readout')?.textContent).toBe('in 0:01 · out 0:03');
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((30 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo((59 / 89) * 100);
    expect(document.querySelectorAll('.loop-handle')).toHaveLength(1);
  });

  it('wraps playback past a lone out point back to the track start (#245)', async () => {
    const fake = await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: '60' } });
    key(window, { key: 'o' });
    act(() => flushRaf());
    fake.state.paused = false;
    fake.state.currentTime = 70 / 30;
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(0.5 / 30);
  });

  it('resumes an end-of-file lone in point at the in point (#245)', async () => {
    const fake = await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: '30' } });
    key(window, { key: 'i' });
    act(() => flushRaf());
    fake.state.ended = true;
    fake.state.paused = true;
    key(window, { key: ' ' });
    expect(fake.play).toHaveBeenCalledTimes(1);
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(30.5 / 30);
    await waitFor(() => expect(fakeScene.setFrame).toHaveBeenCalledWith(30));
  });

  it('preselects the In–Out segment in the export dialog for a lone point (#245)', async () => {
    await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: '30' } });
    key(window, { key: 'i' });
    clickMenuItem('Export video…');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /In–Out segment/ }).checked).toBe(true);
  });

  it('keeps a mid-drag point move from crossing the points (#245)', async () => {
    await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: '30' } });
    key(window, { key: 'i' });
    fireEvent.change(scrub, { target: { value: '60' } });
    key(window, { key: 'o' });
    act(() => flushRaf());
    const track = document.querySelector('.track') as HTMLElement;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
    pointer('pointerdown', document.querySelector('.loop-handle-in') as HTMLElement);
    // The out point supersedes the held in point mid-gesture (#245): further
    // pointer moves must not write the stale in point back over it.
    fireEvent.change(scrub, { target: { value: '20' } });
    key(window, { key: 'o' });
    act(() => flushRaf());
    pointer('pointermove', window, { clientX: 50 });
    pointer('pointerup', window);
    expect(document.querySelector('.loop-readout')?.textContent).toBe('in 0:00 · out 0:01');
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo(0);
    expect(parseFloat(band.style.width)).toBeCloseTo((20 / 89) * 100);
  });

  it('keeps a drag from resurrecting a point cleared with Esc (#245)', async () => {
    await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: '50' } });
    key(window, { key: 'i' });
    act(() => flushRaf());
    const track = document.querySelector('.track') as HTMLElement;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
    pointer('pointerdown', document.querySelector('.loop-handle-in') as HTMLElement);
    key(window, { key: 'Escape' });
    pointer('pointermove', window, { clientX: 70 });
    pointer('pointerup', window);
    expect(document.querySelector('.loop-readout')?.textContent).toBe('');
    expect(document.querySelector('.loop-band')).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Clear in and out points' }).disabled,
    ).toBe(true);
  });

  it('clamps a dragged handle against the live out point when moved outward mid-drag (#314)', async () => {
    await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: '30' } });
    key(window, { key: 'i' });
    fireEvent.change(scrub, { target: { value: '60' } });
    key(window, { key: 'o' });
    act(() => flushRaf());
    const track = document.querySelector('.track') as HTMLElement;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
    pointer('pointerdown', document.querySelector('.loop-handle-in') as HTMLElement);
    // Move the out point outward to frame 89 mid-drag via O: the in handle must
    // drag past the stale frame-60 bound instead of clamping at 59.
    fireEvent.change(scrub, { target: { value: '89' } });
    key(window, { key: 'o' });
    act(() => flushRaf());
    pointer('pointermove', window, { clientX: 80 });
    pointer('pointerup', window);
    // 0.8 * 89 = 71.2 -> frame 71 (~2s at 30 fps); frame 89 rounds to 0:03
    expect(document.querySelector('.loop-readout')?.textContent).toBe('in 0:02 · out 0:03');
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((71 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo(((89 - 71) / 89) * 100);
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

  it('keeps player keys inert while typing in a dialog field', async () => {
    const onOpen = vi.fn();
    const fake = await renderPlayer(onOpen);
    clickMenuItem('Map appearance…');
    const field = screen.getByLabelText('Intro length');
    key(field, { key: '3' });
    key(field, { key: ' ' });
    expect(fake.state.playbackRate).toBe(1);
    expect(fake.play).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keeps player keys inert while the Map appearance dialog is open (#274)', async () => {
    const onOpen = vi.fn();
    const fake = await renderPlayer(onOpen);
    clickMenuItem('Map appearance…');
    key(window, { key: ' ' });
    key(window, { key: 'o', ctrlKey: true });
    expect(fake.play).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('leaves Esc on an open select dropdown to the select', async () => {
    await renderPlayer();
    clickMenuItem('Export video…');
    const select = screen.getByLabelText<HTMLSelectElement>('Codec');
    key(select, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Export video' })).toBeTruthy();
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Export video' })).toBeNull();
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
        openState={{ kind: 'preparing', progress: INITIAL_PREPARE_PROGRESS }}
      />,
    );
    expect(screen.getByText('Reading the recording…')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Preparation progress' })).toBeTruthy();
    openMenu('File');
    expect(
      within(menuBar()).getByRole('menuitem', { name: 'Open…' }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      within(menuBar()).getByRole('menuitem', { name: 'Export video…' }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      within(menuBar()).getByRole('menuitem', { name: 'Export telemetry…' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });
});

describe.each<PickState>([{ kind: 'idle' }, { kind: 'picking' }, { kind: 'canceled' }, { kind: 'ready' }])(
  'PlayerChrome with the $kind open state',
  (openState) => {
    it('shows no notice and keeps Open available', async () => {
      render(
        <Chrome
          session={SESSION}
          settings={SETTINGS}
          onSettingsChange={() => {}}
          onOpen={() => {}}
          openState={openState}
        />,
      );
      await waitFor(() => expect(screen.queryByText('Preparing map…')).toBeNull());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.querySelector('.player-notices')).toBeNull();
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
      pickTrackOutput: vi.fn(async () => ({ ok: true, path: '/exports/flight.telemetry.json' })),
      saveTrack: vi.fn(async () => ({ ok: true })),
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
      pickTrackOutput: vi.fn(async () => ({ ok: false, canceled: true })),
    });
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    clickMenuItem('Export telemetry…');
    await settle();

    expect(bridge.saveTrack).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the error dialog when the pick fails, so the failure is never silent', async () => {
    const bridge = installTelemetryBridge({
      pickTrackOutput: vi.fn(async () => ({ ok: false, error: 'the dialog went away' })),
    });
    render(<Chrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    clickMenuItem('Export telemetry…');
    await settle();

    expect(bridge.saveTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Export telemetry' })).toBeTruthy();
    expect(screen.getByText('the dialog went away')).toBeTruthy();
  });

  it('keeps the dialog up during the write and surfaces a late failure', async () => {
    let finish = null as ((ack: { ok: boolean; error?: string }) => void) | null;
    installTelemetryBridge({
      saveTrack: vi.fn(
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
      saveTrack: vi.fn(
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

    fireEvent.click(screen.getByRole('button', { name: 'Clear in and out points' }));
    if (finish) finish({ ok: true });
    await settle();
    expect(screen.getByText('Covers the In–Out segment (0:00–0:02 · 51 frames)')).toBeTruthy();
  });

  it('resolves a lone in point into the saved telemetry range (#245)', async () => {
    const bridge = installTelemetryBridge();
    await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: '10' } });
    key(window, { key: 'i' });
    clickMenuItem('Export telemetry…');
    await settle();
    expect(bridge.saveTrack).toHaveBeenCalledWith(
      expect.objectContaining({ range: { start: 10, end: 89 } }),
    );
    expect(screen.getByText('Covers the In–Out segment (0:00–0:03 · 80 frames)')).toBeTruthy();
  });
});
