// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMenuKeys } from '../../ui/hooks/useMenuKeys.js';
import type { MenuFlags, MenuItemId } from '../../ui/lib/menumodel.js';

afterEach(cleanup);

const LOADED: MenuFlags = { hasRecording: true, opening: false };
const EMPTY: MenuFlags = { hasRecording: false, opening: false };

function mount(flags: MenuFlags = LOADED) {
  const onActivate = vi.fn<(item: MenuItemId) => void>();
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const view = renderHook(
    (props: { flags: MenuFlags; modalOpen: boolean }) =>
      useMenuKeys(props.flags, {
        modalOpen: props.modalOpen,
        onActivate,
        onOpenChange,
      }),
    { initialProps: { flags, modalOpen: false } },
  );
  return { ...view, onActivate, onOpenChange };
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
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
