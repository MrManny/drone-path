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
  onOpen: () => void;
  onExportVideo: () => void;
  onExportTelemetry: () => void;
  onSettings: () => void;
  onSwap: () => void;
  onDocumentation: () => void;
  onExit: () => void;
  onMenuOpenChange: (open: boolean) => void;
  /** Element the map appearance popover treats as its trigger. */
  barRef?: RefObject<HTMLElement | null>;
}

export function MenuBar({
  hasRecording,
  opening,
  modalOpen,
  itemTitles,
  onOpen,
  onExportVideo,
  onExportTelemetry,
  onSettings,
  onSwap,
  onDocumentation,
  onExit,
  onMenuOpenChange,
  barRef,
}: MenuBarProps) {
  const flags = useMemo<MenuFlags>(
    () => ({ hasRecording, opening }),
    [hasRecording, opening],
  );
  const handleActivate = useCallback(
    (item: MenuItemId) => {
      switch (item) {
        case 'open':
          onOpen();
          return;
        case 'exportVideo':
          onExportVideo();
          return;
        case 'exportTelemetry':
          onExportTelemetry();
          return;
        case 'settings':
          onSettings();
          return;
        case 'swap':
          onSwap();
          return;
        case 'documentation':
          onDocumentation();
          return;
        case 'exit':
          onExit();
          return;
      }
    },
    [onOpen, onExportVideo, onExportTelemetry, onSettings, onSwap, onDocumentation, onExit],
  );
  const { state, dispatch } = useMenuKeys(flags, {
    modalOpen,
    onActivate: handleActivate,
    onOpenChange: onMenuOpenChange,
  });

  const rootRef = useRef<HTMLDivElement | null>(null);
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

  const labelRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});
  const wasOpen = useRef<MenuId | null>(null);
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
    <div className="menu-bar" role="menubar" ref={setRoot} tabIndex={-1}>
      {MENU_BAR.map((menu) => {
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
