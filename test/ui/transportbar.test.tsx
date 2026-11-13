// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TransportBar } from '../../ui/components/TransportBar.js';

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

function renderBar(
  overrides: Partial<Parameters<typeof TransportBar>[0]> = {},
  container?: HTMLElement,
) {
  const dispatch = vi.fn();
  const timeRef = createRef<HTMLSpanElement>();
  render(
    <TransportBar
      dispatch={dispatch}
      ready
      playing={false}
      speed={1}
      fps={30}
      durationSec={3}
      timeRef={timeRef}
      {...overrides}
    />,
    container ? { container } : undefined,
  );
  return { dispatch, timeRef };
}

describe('TransportBar', () => {
  it('dispatches the skip actions from the transport buttons', () => {
    const { dispatch } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to start' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'seekStart' });
    fireEvent.click(screen.getByRole('button', { name: 'Jump to end' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'seekEnd' });
    expect(screen.getByRole('button', { name: 'Jump to start' }).getAttribute('title')).toBe(
      'Jump to start (Home)',
    );
    expect(screen.getByRole('button', { name: 'Jump to end' }).getAttribute('title')).toBe(
      'Jump to end (End)',
    );
  });

  it('toggles playback from the play button', () => {
    const { dispatch } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'togglePlay' });
  });

  it.for([
    { ready: true, playing: false, label: 'Play', disabled: false },
    { ready: true, playing: true, label: 'Pause', disabled: false },
    { ready: false, playing: false, label: 'Play', disabled: true },
  ])('shows $label while ready is $ready and playing is $playing', ({ ready, playing, label, disabled }) => {
    renderBar({ ready, playing });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: label });
    expect(button.disabled).toBe(disabled);
  });

  it('shows the position readout from raw values', () => {
    const { timeRef } = renderBar();
    expect(timeRef.current?.textContent).toBe('0:00 / 0:03');
  });

  it('collects the speed segments in one labeled group', () => {
    const { dispatch } = renderBar({ speed: 2 });
    const group = screen.getByRole('group', { name: 'Playback speed' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '1×',
      '2×',
      '3×',
      '4×',
    ]);
    const pressed = within(group)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true', 'false', 'false']);
    fireEvent.click(screen.getByRole('button', { name: '3×' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'speed', rate: 3 });
    expect(
      screen.getByRole('button', { name: '3×' }).getAttribute('title'),
    ).toBe('Playback speed 3× (3)');
  });
});

describe('TransportBar arrangement', () => {
  function regions() {
    const [readout, cluster, speed] = Array.from(
      (document.querySelector('.transport') as HTMLElement).children,
    );
    return { readout, cluster, speed };
  }

  it('places the time readout, the control cluster and the speed group left to right', () => {
    renderBar();
    const { readout, cluster, speed } = regions();
    expect([readout, cluster, speed].map((region) => region.className)).toEqual([
      'readout transport-time',
      'transport-group transport-cluster',
      'transport-group transport-speed',
    ]);
    expect(readout.textContent).toBe('0:00 / 0:03');
    expect(
      within(cluster as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(['Jump to start', 'Play', 'Jump to end']);
    within(speed as HTMLElement).getByRole('group', { name: 'Playback speed' });
  });

  it('holds the three regions while playback is not ready', () => {
    renderBar({ ready: false });
    const { cluster } = regions();
    expect(
      within(cluster as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(['Jump to start', 'Play', 'Jump to end']);
  });
});

const PLAY_STATES = [
  { ready: true, playing: false, label: 'Play', title: 'Play (Space / K)' },
  { ready: true, playing: true, label: 'Pause', title: 'Pause (Space / K)' },
  { ready: false, playing: false, label: 'Play', title: 'Play (Space / K)' },
];

describe('TransportBar play button is icon-only', () => {
  it.for(PLAY_STATES)(
    'shows the $label glyph with its accessible name and tooltip',
    ({ ready, playing, label, title }) => {
      renderBar({ ready, playing });
      const button = screen.getByRole('button', { name: label });
      expect(button.textContent).toBe('');
      expect(button.querySelector('svg')).toBeTruthy();
      expect(button.getAttribute('title')).toBe(title);
    },
  );

  it('holds one width-bearing footprint across the Play, Pause and not-ready states', () => {
    const footprints = PLAY_STATES.map(({ label, ...props }) => {
      renderBar(props);
      const button = screen.getByRole('button', { name: label });
      const style = getComputedStyle(button);
      const footprint = [button.className, button.textContent ?? '', style.padding];
      cleanup();
      return JSON.stringify(footprint);
    });
    expect(new Set(footprints).size).toBe(1);
  });

  it('shares one icon-button recipe with the jump buttons', () => {
    renderBar();
    const buttons = [...document.querySelectorAll('.transport-cluster button')];
    expect(buttons).toHaveLength(3);
    const footprints = buttons.map((button) => {
      const style = getComputedStyle(button);
      return JSON.stringify([button.className, style.padding, button.textContent ?? '']);
    });
    expect(new Set(footprints).size).toBe(1);
  });
});

describe('TransportBar centering contract', () => {
  let workspace: HTMLElement | undefined;

  afterEach(() => {
    workspace?.remove();
    workspace = undefined;
  });

  function mountTransport(layout: 'split' | 'overlay'): HTMLElement {
    workspace = document.createElement('div');
    workspace.className = 'workspace';
    document.body.append(workspace);
    renderBar({}, workspace);
    const stage = document.createElement('div');
    stage.className = `stage stage-${layout}`;
    stage.innerHTML = `<div class="map-card map-card-${layout}"></div>`;
    workspace.prepend(stage);
    return workspace.querySelector('.transport') as HTMLElement;
  }

  it.for([{ layout: 'split' as const }, { layout: 'overlay' as const }])(
    'keeps the readout left and the cluster on the pane center in the $layout layout',
    ({ layout }) => {
      const transport = mountTransport(layout);
      const time = transport.querySelector('.transport-time') as HTMLElement;
      const cluster = transport.querySelector('.transport-cluster') as HTMLElement;
      const speed = transport.querySelector('.transport-speed') as HTMLElement;
      expect(getComputedStyle(time).justifySelf).toBe('start');
      expect(getComputedStyle(time).gridColumn).toBe('1');
      expect(getComputedStyle(cluster).justifySelf).toBe('center');
      expect(getComputedStyle(cluster).gridColumn).toBe('1');
      expect(getComputedStyle(speed).justifySelf).toBe('end');
    },
  );

  it.for([
    {
      layout: 'split' as const,
      columns: 'minmax(0px, 1fr) clamp(280px, 28%, 372px)',
      speedColumn: '2',
    },
    { layout: 'overlay' as const, columns: 'minmax(0px, 1fr)', speedColumn: '1' },
  ])('mirrors the stage columns in the $layout layout', ({ layout, columns, speedColumn }) => {
    const transport = mountTransport(layout);
    expect(getComputedStyle(transport).gridTemplateColumns).toBe(columns);
    const speed = transport.querySelector('.transport-speed') as HTMLElement;
    expect(getComputedStyle(speed).gridColumn).toBe(speedColumn);
  });

  it('reads the rail width from one shared token', () => {
    const transport = mountTransport('split');
    expect(getComputedStyle(transport).gridTemplateColumns).toContain('clamp(280px, 28%, 372px)');
    const rail = document.querySelector('.map-card-split') as HTMLElement;
    expect(getComputedStyle(rail).width).toContain('clamp(280px, 28%, 372px)');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--rail-w')).toMatch(
      /clamp\(280px,\s*28%,\s*372px\)/,
    );
  });
});

describe('TransportBar disabled mode', () => {
  it('disables the whole cluster and speed group while nothing is loaded', () => {
    renderBar({ disabled: true, ready: false, fps: 0, durationSec: 0 });
    for (const name of ['Jump to start', 'Play', 'Jump to end']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
    const group = screen.getByRole('group', { name: 'Playback speed' });
    for (const button of within(group).getAllByRole<HTMLButtonElement>('button')) {
      expect(button.disabled).toBe(true);
    }
  });

  it('keeps the row intact with a quiet zero readout', () => {
    const { timeRef } = renderBar({ disabled: true, ready: false, fps: 0, durationSec: 0 });
    expect(timeRef.current?.textContent).toBe('0:00 / 0:00');
    const regions = [...(document.querySelector('.transport') as HTMLElement).children].map(
      (region) => region.className,
    );
    expect(regions).toEqual([
      'readout transport-time',
      'transport-group transport-cluster',
      'transport-group transport-speed',
    ]);
    expect(screen.getByRole('button', { name: 'Play' }).textContent).toBe('');
  });

  it('keeps the Play state name while not ready', () => {
    renderBar({ disabled: true, ready: false, playing: true });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Play' });
    expect(button.disabled).toBe(true);
  });
});
