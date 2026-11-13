// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MenuKeysOptions } from '../../ui/hooks/useMenuKeys.js';
import { useMenuKeys } from '../../ui/hooks/useMenuKeys.js';
import type { MenuFlags, MenuItemId } from '../../ui/lib/menumodel.js';

afterEach(cleanup);

const LOADED: MenuFlags = { hasRecording: true, opening: false };
const EMPTY: MenuFlags = { hasRecording: false, opening: false };

function mount(flags: MenuFlags = LOADED, extra: Partial<MenuKeysOptions> = {}) {
  const onActivate = vi.fn<(item: MenuItemId) => void>();
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const view = renderHook(
    (props: { flags: MenuFlags; modalOpen: boolean }) =>
      useMenuKeys(props.flags, {
        modalOpen: props.modalOpen,
        onActivate,
        onOpenChange,
        ...extra,
      }),
    { initialProps: { flags, modalOpen: false } },
  );
  return { ...view, onActivate, onOpenChange };
}

function key(
  type: 'keydown' | 'keyup',
  init: KeyboardEventInit,
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function altTap(): void {
  key('keydown', { key: 'Alt' });
  key('keyup', { key: 'Alt' });
}

describe('useMenuKeys', () => {
  it('opens File on a bare Alt press-and-release', () => {
    const { result, onOpenChange } = mount();
    altTap();
    expect(result.current.state.open).toBe('file');
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('opens menus on their Alt mnemonics', () => {
    const { result } = mount();
    key('keydown', { key: 'v', altKey: true });
    expect(result.current.state).toMatchObject({ open: 'view', active: 0 });
  });

  it('moves through the rows and activates the highlighted one', () => {
    const { result, onActivate, onOpenChange } = mount();
    key('keydown', { key: 'f', altKey: true });
    expect(result.current.state.active).toBe(0);
    key('keydown', { key: 'ArrowDown' });
    expect(result.current.state.active).toBe(1);
    key('keydown', { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith('exportVideo');
    expect(result.current.state.open).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('yields nothing for a disabled row and keeps the menu open', () => {
    const { result, onActivate } = mount(EMPTY);
    key('keydown', { key: 'f', altKey: true });
    key('keydown', { key: 'ArrowDown' });
    key('keydown', { key: ' ' });
    expect(onActivate).not.toHaveBeenCalled();
    expect(result.current.state.open).toBe('file');
  });

  it('closes on Escape without activating', () => {
    const { result, onActivate } = mount();
    key('keydown', { key: 'f', altKey: true });
    key('keydown', { key: 'Escape' });
    expect(result.current.state.open).toBeNull();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('is inert while a modal dialog is open', () => {
    const { result, rerender } = mount();
    rerender({ flags: LOADED, modalOpen: true });
    altTap();
    key('keydown', { key: 'f', altKey: true });
    expect(result.current.state.open).toBeNull();
  });

  it('runs pointer events through the same model', () => {
    const { result, onActivate } = mount();
    act(() => result.current.dispatch({ type: 'toggle', menu: 'file' }));
    expect(result.current.state.open).toBe('file');
    act(() => result.current.dispatch({ type: 'activateRow', index: 2 }));
    expect(onActivate).toHaveBeenCalledWith('exportTelemetry');
    expect(result.current.state.open).toBeNull();
  });
});

describe('useMenuKeys AltGr chords (#238)', () => {
  it.for(['f', 'v', 'h'])('lets Ctrl+Alt+%s type instead of claiming it', (letter) => {
    const { result } = mount();
    const event = key('keydown', { key: letter, altKey: true, ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.state.open).toBeNull();
  });

  it.for(['f', 'v', 'h'])('lets Cmd+Alt+%s type instead of claiming it', (letter) => {
    const { result } = mount();
    const event = key('keydown', { key: letter, altKey: true, metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.state.open).toBeNull();
  });

  it('never arms the Alt toggle from an AltGr press', () => {
    const { result } = mount();
    const alt = key('keydown', { key: 'Alt', ctrlKey: true });
    expect(alt.defaultPrevented).toBe(false);
    key('keyup', { key: 'Alt', ctrlKey: true });
    expect(result.current.state.open).toBeNull();
    expect(result.current.state.altPending).toBe(false);
  });

  it('still claims the plain Alt accelerators', () => {
    mount();
    const event = key('keydown', { key: 'f', altKey: true });
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('useMenuKeys closed-bar label arrows (#238)', () => {
  function barSetup() {
    const bar = document.createElement('div');
    const outside = document.createElement('div');
    document.body.append(bar, outside);
    const view = mount(LOADED, { inBar: (target) => target === bar });
    const teardown = () => {
      bar.remove();
      outside.remove();
    };
    return { bar, outside, teardown, ...view };
  }

  it('claims Left/Right inside the bar and walks the labels', () => {
    const { bar, teardown, result } = barSetup();
    const event = key('keydown', { key: 'ArrowRight' }, bar);
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.state).toMatchObject({ open: null, label: 1 });
    key('keydown', { key: 'ArrowLeft' }, bar);
    expect(result.current.state.label).toBe(0);
    teardown();
  });

  it('leaves the arrows alone outside the bar', () => {
    const { outside, teardown, result } = barSetup();
    const event = key('keydown', { key: 'ArrowRight' }, outside);
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.state.label).toBe(0);
    teardown();
  });

  it('leaves Alt+arrows alone even inside the bar', () => {
    const { bar, teardown, result } = barSetup();
    const event = key('keydown', { key: 'ArrowRight', altKey: true }, bar);
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.state.label).toBe(0);
    teardown();
  });
});
