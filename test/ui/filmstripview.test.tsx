// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Filmstrip } from '../../ui/components/Filmstrip.js';
import type { ThumbSampler } from '../../ui/lib/thumbsampler.js';

function fakeSampler(): ThumbSampler & { grabbed: number[] } {
  const grabbed: number[] = [];
  return {
    grabbed,
    grab: async (frame: number) => {
      grabbed.push(frame);
      return `blob:${frame}`;
    },
    dispose: () => {},
  };
}

// jsdom reports zero widths; the strip plans its thumbs from the track width.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 640,
  });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  cleanup();
});

describe('Filmstrip', () => {
  it('is decorative for assistive technology', () => {
    const sampler = fakeSampler();
    render(<Filmstrip src="/video" frames={90} fps={30} sampler={sampler} />);
    const strip = document.querySelector('.filmstrip') as HTMLElement;
    expect(strip.getAttribute('aria-hidden')).toBe('true');
  });

  it('plans its cells by track width and fills them as thumbs arrive', async () => {
    const sampler = fakeSampler();
    render(<Filmstrip src="/video" frames={90} fps={30} sampler={sampler} />);
    expect(document.querySelectorAll('.film-cell')).toHaveLength(10);
    await waitFor(() => expect(document.querySelectorAll('.film-cell img')).toHaveLength(10));
    expect(sampler.grabbed.length).toBe(10);
    expect(sampler.grabbed[0]).toBe(0);
    expect(sampler.grabbed[sampler.grabbed.length - 1]).toBe(89);
  });

  it('shows a thumbnail only in its own planned cell', async () => {
    const sampler = fakeSampler();
    render(<Filmstrip src="/video" frames={90} fps={30} sampler={sampler} />);
    await waitFor(() => expect(document.querySelectorAll('.film-cell img')).toHaveLength(10));
    const cells = [...document.querySelectorAll('.film-cell')];
    expect(cells.some((cell) => cell.querySelector('img')?.getAttribute('src') === 'blob:0')).toBe(
      true,
    );
  });
});
