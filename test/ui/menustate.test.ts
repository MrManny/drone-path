import { describe, expect, it } from 'vitest';

import type { MenuFlags, MenuId } from '../../ui/lib/menumodel.js';
import { INITIAL_MENU_STATE, reduceMenu } from '../../ui/lib/menustate.js';
import type { MenuEvent, MenuState } from '../../ui/lib/menustate.js';

const LOADED: MenuFlags = { hasRecording: true, opening: false };
const EMPTY: MenuFlags = { hasRecording: false, opening: false };

function run(
  events: MenuEvent[],
  flags: MenuFlags = LOADED,
  from: MenuState = INITIAL_MENU_STATE,
): { state: MenuState; commands: unknown[] } {
  let state = from;
  const commands: unknown[] = [];
  for (const event of events) {
    const result = reduceMenu(state, event, flags);
    state = result.state;
    if (result.command) commands.push(result.command);
  }
  return { state, commands };
}

describe('reduceMenu pointer behavior', () => {
  it('opens a menu on its label without highlighting a row', () => {
    const { state } = run([{ type: 'toggle', menu: 'file' }]);
    expect(state).toEqual({ open: 'file', active: null, altPending: false });
  });

  it('toggles the open menu closed', () => {
    const { state } = run([
      { type: 'toggle', menu: 'file' },
      { type: 'toggle', menu: 'file' },
    ]);
    expect(state.open).toBeNull();
  });

  it('switches between open menus on label hover', () => {
    const { state } = run([
      { type: 'toggle', menu: 'file' },
      { type: 'hoverMenu', menu: 'view' },
    ]);
    expect(state.open).toBe('view');
  });

  it('keeps the bar closed when hovering labels with nothing open', () => {
    const { state } = run([{ type: 'hoverMenu', menu: 'view' }]);
    expect(state.open).toBeNull();
  });

  it('highlights the hovered row only while a menu is open', () => {
    const open = run([{ type: 'toggle', menu: 'file' }, { type: 'hoverRow', index: 2 }]);
    expect(open.state.active).toBe(2);
    const closed = run([{ type: 'hoverRow', index: 2 }]);
    expect(closed.state.active).toBeNull();
  });

  it('closes everything on an outside click', () => {
    const { state } = run([
      { type: 'toggle', menu: 'file' },
      { type: 'hoverRow', index: 1 },
      { type: 'close' },
    ]);
    expect(state).toEqual(INITIAL_MENU_STATE);
  });

  it('runs the clicked row and closes the menu', () => {
    const { state, commands } = run([
      { type: 'toggle', menu: 'file' },
      { type: 'activateRow', index: 0 },
    ]);
    expect(state.open).toBeNull();
    expect(commands).toEqual([{ type: 'activate', item: 'open' }]);
  });

  it('ignores a clicked row outside an open menu', () => {
    const { commands } = run([{ type: 'activateRow', index: 0 }]);
    expect(commands).toEqual([]);
  });
});

describe('reduceMenu keyboard navigation', () => {
  const opened: MenuState = { open: 'file', active: null, altPending: false };

  it('walks the rows with ArrowDown and wraps', () => {
    const downs = (count: number): MenuEvent[] =>
      Array.from({ length: count }, () => ({ type: 'keyDown', key: 'ArrowDown' }) as const);
    expect(run(downs(5), LOADED, opened).state.active).toBe(4);
    expect(run(downs(6), LOADED, opened).state.active).toBe(0);
  });

  it('walks upwards from the end and wraps', () => {
    const { state } = run(
      [
        { type: 'keyDown', key: 'ArrowUp' },
        { type: 'keyDown', key: 'ArrowUp' },
      ],
      LOADED,
      opened,
    );
    expect(state.active).toBe(3);
  });

  it('switches menus with the arrow keys, preselecting the first row', () => {
    const right = run([{ type: 'keyDown', key: 'ArrowRight' }], LOADED, opened);
    expect(right.state).toMatchObject({ open: 'view', active: 0 });
    const left = run([{ type: 'keyDown', key: 'ArrowLeft' }], LOADED, opened);
    expect(left.state).toMatchObject({ open: 'help', active: 0 });
  });

  it('activates the highlighted row and closes the menu', () => {
    for (const key of ['Enter', ' ', 'Spacebar']) {
      const { state, commands } = run(
        [{ type: 'keyDown', key: 'ArrowDown' }, { type: 'keyDown', key }],
        LOADED,
        opened,
      );
      expect(state.open).toBeNull();
      expect(commands).toEqual([{ type: 'activate', item: 'open' }]);
    }
  });

  it('closes on Escape without running anything', () => {
    const { state, commands } = run([{ type: 'keyDown', key: 'Escape' }], LOADED, opened);
    expect(state.open).toBeNull();
    expect(commands).toEqual([]);
  });

  it('ignores held Enter and held arrows for activation', () => {
    const { state, commands } = run(
      [
        { type: 'keyDown', key: 'ArrowDown' },
        { type: 'keyDown', key: 'Enter', repeat: true },
      ],
      LOADED,
      opened,
    );
    expect(state.open).toBe('file');
    expect(commands).toEqual([]);
  });

  it('does nothing for unclaimed keys', () => {
    const { state, commands } = run([{ type: 'keyDown', key: 'x' }], LOADED, opened);
    expect(state).toEqual(opened);
    expect(commands).toEqual([]);
  });
});

describe('reduceMenu activation rules', () => {
  const onDisabled: MenuState = { open: 'file', active: 1, altPending: false };

  it('keeps the menu open and yields nothing for a disabled row', () => {
    const { state, commands } = run([{ type: 'keyDown', key: 'Enter' }], EMPTY, onDisabled);
    expect(state).toEqual(onDisabled);
    expect(commands).toEqual([]);
  });

  it('ignores Enter and Space until a row is highlighted', () => {
    const opened: MenuState = { open: 'file', active: null, altPending: false };
    const { state, commands } = run([{ type: 'keyDown', key: 'Enter' }], LOADED, opened);
    expect(state).toEqual(opened);
    expect(commands).toEqual([]);
  });
});

describe('reduceMenu Alt behavior', () => {
  it('opens File on a bare press-and-release of Alt', () => {
    const { state } = run([
      { type: 'keyDown', key: 'Alt' },
      { type: 'keyUp', key: 'Alt' },
    ]);
    expect(state).toMatchObject({ open: 'file', active: 0, altPending: false });
  });

  it('closes the bar on a second bare Alt press-and-release', () => {
    const { state } = run([
      { type: 'toggle', menu: 'file' },
      { type: 'keyDown', key: 'Alt' },
      { type: 'keyUp', key: 'Alt' },
    ]);
    expect(state.open).toBeNull();
  });

  it.for<{ menu: MenuId; key: string }>([
    { menu: 'file', key: 'f' },
    { menu: 'view', key: 'v' },
    { menu: 'help', key: 'h' },
  ])('opens $menu on Alt+$key directly', ({ menu, key }) => {
    const { state } = run([
      { type: 'keyDown', key: 'Alt' },
      { type: 'keyDown', key: key.toUpperCase(), altKey: true },
      { type: 'keyUp', key: 'Alt' },
    ]);
    expect(state).toMatchObject({ open: menu, active: 0, altPending: false });
  });

  it('does not toggle the bar for Alt with another key', () => {
    const { state } = run([
      { type: 'keyDown', key: 'Alt' },
      { type: 'keyDown', key: 'x', altKey: true },
      { type: 'keyUp', key: 'Alt' },
    ]);
    expect(state.open).toBeNull();
  });

  it('cancels the Alt toggle once another key is pressed', () => {
    const { state } = run([
      { type: 'keyDown', key: 'Alt' },
      { type: 'keyDown', key: 'Escape' },
      { type: 'keyUp', key: 'Alt' },
    ]);
    expect(state.open).toBeNull();
    expect(state.altPending).toBe(false);
  });

  it('ignores the Alt key auto-repeat', () => {
    const { state } = run([
      { type: 'keyDown', key: 'Alt' },
      { type: 'keyDown', key: 'Alt', repeat: true },
      { type: 'keyUp', key: 'Alt' },
    ]);
    expect(state.open).toBe('file');
  });
});
