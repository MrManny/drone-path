// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TimelinePanel } from '../../ui/components/TimelinePanel.js';
import type { LoopState } from '../../ui/lib/loop.js';

vi.mock('../../ui/components/Filmstrip.js', () => ({
  Filmstrip: () => <div data-testid="filmstrip" />,
}));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The layout contract tests read the real stylesheet, like transportbar.test.tsx.
let stylesheet: HTMLStyleElement;

beforeAll(() => {
  stylesheet = document.createElement('style');
  stylesheet.textContent = fs.readFileSync(path.join(root, 'ui', 'app', 'globals.css'), 'utf8');
  document.head.append(stylesheet);
});

afterAll(() => {
  stylesheet.remove();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface RenderOptions {
  disabled?: boolean;
  loop?: LoopState;
  maxFrame?: number;
  frames?: number;
  durationSec?: number;
}

function renderPanel({
  disabled = false,
  loop = { in: null, out: null },
  maxFrame = 89,
  frames = 90,
  durationSec = 3,
}: RenderOptions = {}) {
  const dispatch = vi.fn();
  const setLoopFrame = vi.fn();
  const scrubTo = vi.fn();
  const scrubRef = createRef<HTMLInputElement>();
  const playheadRef = createRef<HTMLDivElement>();
  render(
    <TimelinePanel
      dispatch={dispatch}
      disabled={disabled}
      loop={loop}
      setLoopFrame={setLoopFrame}
      fps={30}
      frames={frames}
      durationSec={durationSec}
      maxFrame={maxFrame}
      scrubTo={scrubTo}
      scrubRef={scrubRef}
      playheadRef={playheadRef}
      src="/video"
    />,
  );
  return { dispatch, setLoopFrame, scrubTo, scrubRef, playheadRef };
}

function pointer(type: string, target: EventTarget, init: MouseEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

describe('TimelinePanel header', () => {
  it('titles the panel without a loop-points note', () => {
    renderPanel();
    expect(screen.getByText('Timeline')).toBeTruthy();
    expect(screen.queryByText('Playback & loop points')).toBeNull();
  });

  it('dispatches the loop actions from labeled buttons', () => {
    const { dispatch } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Set in point' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'setLoopIn' });
    fireEvent.click(screen.getByRole('button', { name: 'Set out point' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'setLoopOut' });
    expect(screen.getByRole('button', { name: 'Set in point' }).getAttribute('title')).toBe(
      'Set in point (I)',
    );
    expect(screen.getByRole('button', { name: 'Set out point' }).getAttribute('title')).toBe(
      'Set out point (O)',
    );
  });

  it.for([
    { name: 'Set in point', title: 'Set in point (I)' },
    { name: 'Set out point', title: 'Set out point (O)' },
    { name: 'Clear in and out points', title: 'Clear in and out points (Esc)' },
  ])('renders $name icon-only with its tooltip', ({ name, title }) => {
    renderPanel({ loop: { in: 30, out: 60 } });
    const button = screen.getByRole('button', { name });
    expect(button.textContent).toBe('');
    expect(button.getAttribute('title')).toBe(title);
  });

  it('states why Clear is disabled without any loop point', () => {
    renderPanel();
    const clear = screen.getByRole<HTMLButtonElement>('button', { name: 'Clear in and out points' });
    expect(clear.disabled).toBe(true);
    expect(clear.getAttribute('title')).toBe('No in or out point to clear');
  });

  it('clears a set loop and says so in its title', () => {
    const { dispatch } = renderPanel({ loop: { in: 30, out: 60 } });
    const clear = screen.getByRole<HTMLButtonElement>('button', { name: 'Clear in and out points' });
    expect(clear.disabled).toBe(false);
    expect(clear.getAttribute('title')).toBe('Clear in and out points (Esc)');
    fireEvent.click(clear);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'clearLoop' });
  });

  it('collects the three loop buttons in one segmented Loop group (#233)', () => {
    const { dispatch } = renderPanel();
    const group = screen.getByRole('group', { name: 'In and out points' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Set in point',
      'Set out point',
      'Clear in and out points',
    ]);
    for (const button of buttons) {
      expect(button.className).toContain('segment');
      expect(button.className).toContain('segment-icon');
      const style = getComputedStyle(button);
      expect(parseFloat(style.minHeight)).toBe(30);
      expect(parseFloat(style.paddingLeft)).toBe(7);
      expect(parseFloat(style.paddingRight)).toBe(7);
    }
    fireEvent.click(buttons[0]);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'setLoopIn' });
  });

  it.for([
    { name: 'engaged loop', loop: { in: 30, out: 60 }, want: 'in 0:01 · out 0:02' },
    { name: 'loop missing its out point', loop: { in: 30, out: null }, want: 'in 0:01 · out 0:03' },
    { name: 'loop missing its in point', loop: { in: null, out: 60 }, want: 'in 0:00 · out 0:02' },
    { name: 'out-of-order loop', loop: { in: 60, out: 30 }, want: 'in 0:02 · out 0:01' },
  ])('shows the readout for a $name', ({ loop, want }) => {
    renderPanel({ loop });
    expect(document.querySelector('.loop-readout')?.textContent).toBe(want);
  });

  it('announces readout changes through a polite live region (#245)', () => {
    renderPanel({ loop: { in: 30, out: null } });
    const slot = document.querySelector('.loop-readout') as HTMLElement;
    expect(slot.getAttribute('aria-live')).toBe('polite');
    expect(slot.getAttribute('aria-atomic')).toBe('true');
  });

  it('reserves an empty readout slot without points (#233)', () => {
    renderPanel();
    const slot = document.querySelector('.loop-readout') as HTMLElement;
    expect(slot.textContent).toBe('');
    expect(parseFloat(getComputedStyle(slot).minWidth)).toBeGreaterThan(0);
  });

  it('pins the readout slot left of the loop group at the right edge (#233)', () => {
    renderPanel({ loop: { in: 30, out: 60 } });
    const actions = document.querySelector('.timeline-actions') as HTMLElement;
    expect([...actions.children].map((child) => child.className)).toEqual([
      'readout loop-readout',
      'segmented',
    ]);
  });

  it('keeps the loop group at one position with and without a readout (#233)', () => {
    const shape = (): string[] => {
      const actions = document.querySelector('.timeline-actions') as HTMLElement;
      return [...actions.children].map((child) => child.className);
    };
    const slotWidth = (): string =>
      getComputedStyle(document.querySelector('.loop-readout') as HTMLElement).minWidth;
    renderPanel();
    const withoutReadout = shape();
    const widthWithout = slotWidth();
    cleanup();
    renderPanel({ loop: { in: 30, out: 60 } });
    expect(shape()).toEqual(withoutReadout);
    expect(slotWidth()).toBe(widthWithout);
  });
});

describe('TimelinePanel ruler', () => {
  it('labels the ticks with time text over the recording', () => {
    renderPanel({ durationSec: 3 });
    const ticks = [...document.querySelectorAll('.ruler-tick')].map((t) => t.textContent);
    expect(ticks).toEqual(['0:00', '0:01', '0:02', '0:03']);
  });
});

describe('TimelinePanel track', () => {
  it('runs the filmstrip as one continuous strip with no track-label column', () => {
    renderPanel();
    expect(document.querySelector('.track-label')).toBeNull();
    expect(document.querySelector('.track-row')).toBeNull();
    const track = document.querySelector('.track') as HTMLElement;
    expect(track.parentElement?.className).toBe('timeline');
    expect(track.querySelector('[data-testid="filmstrip"]')).toBeTruthy();
    expect(track.querySelector('input[type="range"]')).toBeTruthy();
  });

  it('renders the filmstrip slot and the accessible scrubber', () => {
    renderPanel();
    expect(screen.getByTestId('filmstrip')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeTruthy();
  });

  it('scrubs through the owner', () => {
    const { scrubTo } = renderPanel();
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), {
      target: { value: '42' },
    });
    expect(scrubTo).toHaveBeenCalledWith(42);
  });

  it('announces the scrubber position as a time, not a frame index', () => {
    renderPanel();
    const slider = screen.getByRole('slider', { name: 'Playback position' });
    fireEvent.change(slider, { target: { value: '42' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('0:01 / 0:03');
  });

  it('bands the engaged loop over the track and shows its handles', () => {
    renderPanel({ loop: { in: 30, out: 60 } });
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((30 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo((30 / 89) * 100);
    expect(document.querySelectorAll('.loop-handle')).toHaveLength(2);
  });

  it('bands a lone in point to the track end with only its in handle (#245)', () => {
    renderPanel({ loop: { in: 30, out: null } });
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((30 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo((59 / 89) * 100);
    const handles = document.querySelectorAll('.loop-handle');
    expect(handles).toHaveLength(1);
    expect(handles[0].className).toContain('loop-handle-in');
  });

  it('bands a lone out point from the track start with only its out handle (#245)', () => {
    renderPanel({ loop: { in: null, out: 60 } });
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo(0);
    expect(parseFloat(band.style.width)).toBeCloseTo((60 / 89) * 100);
    const handles = document.querySelectorAll('.loop-handle');
    expect(handles).toHaveLength(1);
    expect(handles[0].className).toContain('loop-handle-out');
  });

  it('drags the lone handle of a half-open band across the track (#245)', () => {
    const { setLoopFrame } = renderPanel({ loop: { in: 30, out: null } });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);
    const handle = document.querySelector('.loop-handle-in') as HTMLElement;
    pointer('pointerdown', handle);
    pointer('pointermove', window, { clientX: 80 });
    expect(setLoopFrame).toHaveBeenLastCalledWith('in', 71);
    pointer('pointerup', window);
    pointer('pointermove', window, { clientX: 20 });
    expect(setLoopFrame).toHaveBeenCalledTimes(1);
  });

  it('shows no band or handles for an out-of-order loop', () => {
    renderPanel({ loop: { in: 60, out: 30 } });
    expect(document.querySelector('.loop-band')).toBeNull();
    expect(document.querySelectorAll('.loop-handle')).toHaveLength(0);
  });

  it('drags the loop in handle, clamped inside the loop, until release', () => {
    const { setLoopFrame } = renderPanel({ loop: { in: 30, out: 60 } });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);
    const handle = document.querySelector('.loop-handle-in') as HTMLElement;
    pointer('pointerdown', handle);
    pointer('pointermove', window, { clientX: 90 });
    expect(setLoopFrame).toHaveBeenLastCalledWith('in', 59);
    pointer('pointermove', window, { clientX: 10 });
    expect(setLoopFrame).toHaveBeenLastCalledWith('in', 9);
    pointer('pointerup', window);
    pointer('pointermove', window, { clientX: 50 });
    expect(setLoopFrame).toHaveBeenCalledTimes(2);
  });

  it('drags the loop out handle within its own clamp', () => {
    const { setLoopFrame } = renderPanel({ loop: { in: 30, out: 60 } });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);
    const handle = document.querySelector('.loop-handle-out') as HTMLElement;
    pointer('pointerdown', handle);
    pointer('pointermove', window, { clientX: 5 });
    expect(setLoopFrame).toHaveBeenLastCalledWith('out', 31);
    pointer('pointerup', window);
  });

  it('stops dragging on pointercancel, not just on release', () => {
    const { setLoopFrame } = renderPanel({ loop: { in: 30, out: 60 } });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);
    const handle = document.querySelector('.loop-handle-in') as HTMLElement;
    pointer('pointerdown', handle);
    pointer('pointermove', window, { clientX: 20 });
    expect(setLoopFrame).toHaveBeenCalledTimes(1);
    pointer('pointercancel', window);
    pointer('pointermove', window, { clientX: 40 });
    expect(setLoopFrame).toHaveBeenCalledTimes(1);
  });
});

describe('TimelinePanel disabled mode', () => {
  it('drops the filmstrip and disables the scrubber while nothing is loaded', () => {
    renderPanel({ disabled: true });
    expect(screen.queryByTestId('filmstrip')).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('slider', { name: 'Playback position' }).disabled,
    ).toBe(true);
  });

  it('disables every loop control', () => {
    renderPanel({ disabled: true, loop: { in: 30, out: 60 } });
    for (const name of ['Set in point', 'Set out point', 'Clear in and out points']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
  });

  it('keeps the track, playhead and ruler holding the row geometry', () => {
    renderPanel({ disabled: true, frames: 0, maxFrame: 0, durationSec: 0 });
    expect(document.querySelector('.track')).toBeTruthy();
    expect(document.querySelector('.playhead')).toBeTruthy();
    expect(document.querySelector('.ruler')).toBeTruthy();
    expect(document.querySelector('.loop-band')).toBeNull();
    expect(document.querySelectorAll('.loop-handle')).toHaveLength(0);
  });
});
