// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Popover } from '../../ui/components/Popover.js';

afterEach(cleanup);

function renderPopover(onClose = vi.fn()) {
  const view = render(
    <Popover label="Map appearance" onClose={onClose}>
      <p>content</p>
    </Popover>,
  );
  return { ...view, onClose };
}

describe('Popover', () => {
  it('is a non-modal panel with the popover name', () => {
    renderPopover();
    const panel = screen.getByRole('dialog', { name: 'Map appearance' });
    expect(panel.classList.contains('map-popover')).toBe(true);
    expect(document.querySelector('.settings-overlay')).toBeNull();
  });

  it('takes focus on open', () => {
    renderPopover();
    const panel = screen.getByRole('dialog', { name: 'Map appearance' });
    expect(document.activeElement).toBe(panel);
  });

  it('closes from its Close button', () => {
    const { onClose } = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click outside and keeps open on one inside', () => {
    const { onClose } = renderPopover();
    const panel = screen.getByRole('dialog', { name: 'Map appearance' });
    fireEvent.mouseDown(panel);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves presses on the trigger to the toggle instead of closing twice', () => {
    const onClose = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();
    render(<button ref={triggerRef}>Map appearance</button>);
    render(
      <Popover label="Map appearance" triggerRef={triggerRef} onClose={onClose}>
        <p>content</p>
      </Popover>,
    );
    fireEvent.mouseDown(triggerRef.current as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Popover docking (#236)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  let stylesheet: HTMLStyleElement;

  beforeEach(() => {
    stylesheet = document.createElement('style');
    stylesheet.textContent = fs.readFileSync(path.join(root, 'ui', 'app', 'globals.css'), 'utf8');
    document.head.append(stylesheet);
  });

  afterEach(() => {
    stylesheet.remove();
  });

  function renderBeside(stage: 'split' | 'overlay') {
    return render(
      <>
        <div className={`stage stage-${stage}`} />
        <Popover label="Map appearance" onClose={() => {}}>
          <p>content</p>
        </Popover>
      </>,
    );
  }

  it('docks left of the map rail over the video letterbox in the split layout', () => {
    renderBeside('split');
    const panel = screen.getByRole('dialog', { name: 'Map appearance' });
    const style = getComputedStyle(panel);
    expect(style.position).toBe('fixed');
    expect(style.right).toContain('clamp(280px, 28%, 372px)');
    // The stage band's top edge: the 33px menu bar + 56px header + 8px gap.
    expect(style.top).toBe('97px');
  });

  it('docks left of the mini-map card in the Swap (PiP) layout', () => {
    renderBeside('overlay');
    const panel = screen.getByRole('dialog', { name: 'Map appearance' });
    expect(getComputedStyle(panel).right).toContain('clamp(180px, 36%, 242px)');
  });

  it('keeps the popover clear of the transport and timeline rows', () => {
    const cssText = stylesheet.textContent ?? '';
    const rule = /^\.map-popover \{([^}]*)\}/m.exec(cssText)?.[1] ?? '';
    expect(rule).toContain('top: calc(var(--menu-h) + var(--header-h) + 8px)');
    expect(rule).toContain(
      'max-height: calc(100vh - var(--menu-h) - var(--header-h) - var(--transport-h) - var(--timeline-h) - 16px)',
    );
    expect(rule).not.toContain('bottom:');
    expect(cssText).not.toContain('--status-h');
  });
});
