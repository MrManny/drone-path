// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimelinePanel } from '../../ui/components/TimelinePanel.js';
import type { LoopState } from '../../ui/lib/loop.js';

// The filmstrip samples real media; the timeline tests cover its slot.
vi.mock('../../ui/components/Filmstrip.js', () => ({
  Filmstrip: () => <div data-testid="filmstrip" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface RenderOptions {
  loop?: LoopState;
  maxFrame?: number;
  frames?: number;
  durationSec?: number;
}

function renderPanel({
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

// Pointer drags travel through window listeners; plain mouse events with
// pointer event types keep the tests free of constructor dependencies.
function pointer(type: string, target: EventTarget, init: MouseEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

describe('TimelinePanel header', () => {
  it('dispatches the loop actions from labeled buttons', () => {
    const { dispatch } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Set loop in' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'setLoopIn' });
    fireEvent.click(screen.getByRole('button', { name: 'Set loop out' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'setLoopOut' });
    expect(screen.getByRole('button', { name: 'Set loop in' }).getAttribute('title')).toBe(
      'Set loop in (I)',
    );
    expect(screen.getByRole('button', { name: 'Set loop out' }).getAttribute('title')).toBe(
      'Set loop out (O)',
    );
  });

  it('states why Clear is disabled without any loop point', () => {
    renderPanel();
    const clear = screen.getByRole<HTMLButtonElement>('button', { name: 'Clear loop' });
    expect(clear.disabled).toBe(true);
    expect(clear.getAttribute('title')).toBe('No loop to clear.');
  });

  it('clears a set loop and says so in its title', () => {
    const { dispatch } = renderPanel({ loop: { in: 30, out: 60 } });
    const clear = screen.getByRole<HTMLButtonElement>('button', { name: 'Clear loop' });
    expect(clear.disabled).toBe(false);
    expect(clear.getAttribute('title')).toBe('Clear loop (Esc)');
    fireEvent.click(clear);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'clearLoop' });
  });

  it.for([
    { name: 'engaged loop', loop: { in: 30, out: 60 }, want: 'loop 0:01–0:02' },
    { name: 'half-marked loop', loop: { in: 30, out: null }, want: 'loop 0:01–?' },
    { name: 'out-of-order loop', loop: { in: 60, out: 30 }, want: 'loop 0:02–0:01' },
  ])('shows the readout for a $name', ({ loop, want }) => {
    renderPanel({ loop });
    expect(document.querySelector('.loop-readout')?.textContent).toBe(want);
  });

  it('shows no loop readout without points', () => {
    renderPanel();
    expect(document.querySelector('.loop-readout')).toBeNull();
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

  it('bands the engaged loop over the track and shows its handles', () => {
    renderPanel({ loop: { in: 30, out: 60 } });
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((30 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo((30 / 89) * 100);
    expect(document.querySelectorAll('.loop-handle')).toHaveLength(2);
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
    // 90% of the track is frame 80, but the in end may not pass out - 1.
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
    // 5% is frame 4, but the out end may not pass in + 1.
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
