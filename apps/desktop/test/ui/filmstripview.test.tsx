// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Filmstrip } from '../../ui/components/Filmstrip.js';
import type { ThumbSampler } from '../../ui/lib/thumbsampler.js';

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
  it.for(['success', 'missing', 'error'] as const)('clears busy after the last sample: %s', async (outcome) => {
    let finish!: () => void;
    const sampler: ThumbSampler = {
      grab: () => new Promise((resolve, reject) => {
        finish = () => {
          if (outcome === 'error') reject(new Error('sample unavailable'));
          else resolve(outcome === 'success' ? 'blob:thumb' : null);
        };
      }),
      dispose: () => {},
    };
    render(<Filmstrip src="/video" frames={1} fps={30} sampler={sampler} />);
    expect(screen.getByRole('status').textContent).toBe('Preparing filmstrip…');
    await act(async () => finish());
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelectorAll('.film-cell img')).toHaveLength(outcome === 'success' ? 1 : 0);
  });

  it('keeps the new recording busy when the old sample finishes', async () => {
    const finish: Array<(value: null) => void> = [];
    const sampler: ThumbSampler = {
      grab: () => new Promise((resolve) => finish.push(resolve)),
      dispose: () => {},
    };
    const view = render(<Filmstrip src="/old" frames={1} fps={30} sampler={sampler} />);
    view.rerender(<Filmstrip src="/new" frames={1} fps={30} sampler={sampler} />);
    await act(async () => finish[0](null));
    expect(screen.getByRole('status').textContent).toBe('Preparing filmstrip…');
    await act(async () => finish[1](null));
    expect(screen.queryByRole('status')).toBeNull();
  });

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

  it('pins the filmstrip CSS contract for spacing and tiles', async () => {
    const sampler = fakeSampler();
    render(<Filmstrip src="/video" frames={90} fps={30} sampler={sampler} />);
    await waitFor(() => expect(document.querySelectorAll('.film-cell img')).toHaveLength(10));
    const strip = getComputedStyle(document.querySelector('.filmstrip') as HTMLElement);
    expect(strip.gap).toBe('8px');
    expect(strip.paddingLeft).toBe('8px');
    expect(strip.paddingRight).toBe('8px');
    const cell = getComputedStyle(document.querySelector('.film-cell') as HTMLElement);
    expect(cell.paddingTop).toBe('6px');
    expect(cell.paddingBottom).toBe('6px');
    const tile = getComputedStyle(document.querySelector('.film-cell img') as HTMLElement);
    expect(tile.maxWidth).toBe('100%');
    expect(tile.maxHeight).toBe('100%');
    expect(tile.boxSizing).toBe('border-box');
    const rules = [...(stylesheet.sheet?.cssRules ?? [])] as CSSStyleRule[];
    const tileRule = rules.find((rule) => rule.selectorText === '.film-cell img');
    expect(tileRule?.style.getPropertyValue('border')).toBe('1px solid var(--hairline)');
  });
});
