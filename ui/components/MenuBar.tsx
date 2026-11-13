'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

import { useMenuKeys } from '../hooks/useMenuKeys.js';
import type { MenuFlags, MenuItemId, MenuId } from '../lib/menumodel.js';
import { MENU_BAR } from '../lib/menumodel.js';
import { MenuPanel } from './MenuPanel.js';

export interface MenuBarProps {
  hasRecording: boolean;
  opening: boolean;
  /** Menu keys are inert while a modal dialog holds the workspace. */
  modalOpen: boolean;
  /** Extra tooltips per item, e.g. the telemetry save scope. */
  itemTitles?: Partial<Record<MenuItemId, string>>;
  onActivate: (item: MenuItemId) => void;
  onMenuOpenChange: (open: boolean) => void;
  /** Element the map appearance popover treats as its trigger. */
  barRef?: RefObject<HTMLElement | null>;
}

export function MenuBar({
  hasRecording,
  opening,
  modalOpen,
  itemTitles,
  onActivate,
  onMenuOpenChange,
  barRef,
}: MenuBarProps) {
  const flags = useMemo<MenuFlags>(
    () => ({ hasRecording, opening }),
    [hasRecording, opening],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});
  const { state, dispatch } = useMenuKeys(flags, {
    modalOpen,
    onActivate,
    onOpenChange: onMenuOpenChange,
    // The closed bar claims Left/Right as label navigation (see useMenuKeys);
    // that claim applies only to events inside the bar.
    inBar: (target) => target instanceof Node && rootRef.current?.contains(target) === true,
  });

  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (barRef) barRef.current = node;
    },
    [barRef],
  );

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      dispatch({ type: 'close' });
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [dispatch]);

  const wasOpen = useRef<MenuId | null>(null);
  const wasLabel = useRef(0);
  // Keyboard label navigation moves DOM focus onto the label that now holds
  // the roving Tab stop. Pointer-driven label changes never reach this: they
  // open a menu in the same transition and focus belongs on its rows.
  useEffect(() => {
    const moved = wasLabel.current !== state.label;
    wasLabel.current = state.label;
    if (!moved || state.open !== null) return;
    labelRefs.current[MENU_BAR[state.label]?.id]?.focus();
  }, [state.label, state.open]);

  // Closing must not strand focus on a removed row: return it to the label of
  // the menu that closed, unless an outside click already moved it away.
  useEffect(() => {
    const previous = wasOpen.current;
    wasOpen.current = state.open;
    if (state.open !== null || previous === null) return;
    // A click elsewhere has already moved focus to a live element: leave it.
    // A removed row (unmounted panel) counts as no focus and gets restored.
    const held = document.activeElement;
    const movedAway =
      held instanceof HTMLElement &&
      held.isConnected &&
      held !== document.body &&
      !rootRef.current?.contains(held);
    if (movedAway) return;
    labelRefs.current[previous]?.focus();
  }, [state.open]);

  return (
    <div
      className="menu-bar"
      role="menubar"
      aria-label="Main menu"
      ref={setRoot}
      tabIndex={-1}
      onKeyDown={(e) => {
        // Tab closes the open menu and stays unclaimed so the browser
        // continues in normal navigation order from the label.
        if (e.key !== 'Tab' || state.open === null) return;
        const menu = state.open;
        dispatch({ type: 'close' });
        labelRefs.current[menu]?.focus();
      }}
      onBlur={(e) => {
        // Focus leaving the bar closes the open menu, like an outside click.
        if (!e.currentTarget.contains(e.relatedTarget)) {
          dispatch({ type: 'close' });
        }
      }}
    >
      {MENU_BAR.map((menu, index) => {
        const open = state.open === menu.id;
        return (
          <div
            className={`menu-bar-slot${menu.align === 'end' ? ' end' : ''}`}
            role="presentation"
            key={menu.id}
          >
            <button
              type="button"
              ref={(node) => {
                labelRefs.current[menu.id] = node;
              }}
              role="menuitem"
              className={`menu-bar-label${open ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open}
              tabIndex={index === state.label ? 0 : -1}
              onClick={() => dispatch({ type: 'toggle', menu: menu.id })}
              onMouseEnter={() => dispatch({ type: 'hoverMenu', menu: menu.id })}
            >
              {menu.label}
            </button>
            {open ? (
              <MenuPanel
                menu={menu}
                active={state.active}
                flags={flags}
                titles={itemTitles}
                onHoverRow={(index) => dispatch({ type: 'hoverRow', index })}
                onActivateRow={(index) => dispatch({ type: 'activateRow', index })}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
