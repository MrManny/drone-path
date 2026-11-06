// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFilmstrip } from '../../ui/hooks/useFilmstrip.js';
import { thumbPlan } from '../../ui/lib/filmstrip.js';
import type { ThumbSampler } from '../../ui/lib/thumbsampler.js';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  disconnect(): void {}
  fire(): void {
    this.callback();
  }
}

function fakeSampler(): ThumbSampler & { grabbed: number[]; disposed: boolean } {
  return {
    grabbed: [],
    disposed: false,
    async grab(frame: number) {
      this.grabbed.push(frame);
      return `blob:${frame}`;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function Harness({
  sampler,
  createSampler,
}: {
  sampler?: ThumbSampler;
  createSampler?: (src: string, fps: number) => ThumbSampler;
}) {
  const { hostRef, cells, thumbs } = useFilmstrip({
    src: '/video',
    frames: 90,
    fps: 30,
    sampler,
    createSampler,
  });
  return (
    <div ref={hostRef} data-testid="host">
      <span data-testid="cells">{cells.join(',')}</span>
      <span data-testid="thumbs">{[...thumbs.keys()].join(',')}</span>
    </div>
  );
}

function setTrackWidth(px: number): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => px,
  });
}

function replan(): void {
  act(() => {
    for (const observer of FakeResizeObserver.instances) observer.fire();
  });
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  setTrackWidth(640);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  cleanup();
});

describe('useFilmstrip', () => {
  it('fills the planned cells once and keeps thumbs across re-plans', async () => {
    const sampler = fakeSampler();
    render(<Harness sampler={sampler} />);
    await waitFor(() => expect(screen.getByTestId('thumbs').textContent).not.toBe(''));
    expect(sampler.grabbed).toHaveLength(10);

    // A re-plan must not re-grab cached frames or rebuild the sampler (#152).
    replan();
    replan();
    await waitFor(() => expect(screen.getByTestId('cells').textContent).not.toBe(''));
    expect(sampler.grabbed).toHaveLength(10);
  });

  it('grabs only the frames a wider plan adds', async () => {
    const sampler = fakeSampler();
    render(<Harness sampler={sampler} />);
    await waitFor(() => expect(sampler.grabbed).toHaveLength(10));

    setTrackWidth(1280);
    replan();
    const union = new Set([
      ...thumbPlan(640, 90).frames,
      ...thumbPlan(1280, 90).frames,
    ]);
    await waitFor(() => expect(sampler.grabbed).toHaveLength(union.size));
    expect(new Set(sampler.grabbed).size).toBe(union.size);
  });

  it('disposes the sampler it created exactly once, on unmount', async () => {
    const sampler = fakeSampler();
    const createSampler = vi.fn(() => sampler);
    const { unmount } = render(<Harness createSampler={createSampler} />);
    await waitFor(() => expect(sampler.grabbed).toHaveLength(10));
    replan();
    expect(createSampler).toHaveBeenCalledTimes(1);
    expect(sampler.disposed).toBe(false);
    unmount();
    expect(sampler.disposed).toBe(true);
  });

  it('leaves an injected sampler with its owner', async () => {
    const sampler = fakeSampler();
    const { unmount } = render(<Harness sampler={sampler} />);
    await waitFor(() => expect(sampler.grabbed).toHaveLength(10));
    unmount();
    expect(sampler.disposed).toBe(false);
  });

  it('loads the plan again when the recording changes', async () => {
    const first = fakeSampler();
    const second = fakeSampler();
    const { rerender } = render(<Harness createSampler={() => first} />);
    await waitFor(() => expect(first.grabbed).toHaveLength(10));
    rerender(<Harness createSampler={() => second} />);
    await waitFor(() => expect(second.grabbed).toHaveLength(10));
  });
});
