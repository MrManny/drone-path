'use client';

import { Fragment, useEffect, useRef } from 'react';

import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownToLine,
  ArrowRightLeft,
  CircleHelp,
  FolderOpen,
  Info,
  Power,
  Settings,
  SquareActivity,
} from 'lucide-react';

import type { MenuDef, MenuFlags, MenuIconId, MenuItemId } from '../lib/menumodel.js';
import { itemEnabled } from '../lib/menumodel.js';
import { MenuRow } from './MenuRow.js';

const ICONS: Record<MenuIconId, LucideIcon> = {
  folderOpen: FolderOpen,
  export: ArrowDownToLine,
  telemetry: SquareActivity,
  settings: Settings,
  exit: Power,
  swap: ArrowRightLeft,
  help: CircleHelp,
  info: Info,
};

export interface MenuPanelProps {
  menu: MenuDef;
  active: number | null;
  flags: MenuFlags;
  titles?: Partial<Record<MenuItemId, string>>;
  onHoverRow: (index: number) => void;
  onActivateRow: (index: number) => void;
}

export function MenuPanel({
  menu,
  active,
  flags,
  titles,
  onHoverRow,
  onActivateRow,
}: MenuPanelProps) {
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving focus: the live row holds DOM focus so a screen reader announces
  // every selection move the highlight shows.
  useEffect(() => {
    if (active === null) return;
    rowRefs.current[active]?.focus();
  }, [active]);

  return (
    <div className="menu-panel" role="menu" aria-label={menu.label}>
      {menu.items.map((item, index) => {
        const ItemIcon = ICONS[item.icon];
        return (
          <Fragment key={item.id}>
            {item.separatorBefore ? <div className="menu-separator" role="separator" /> : null}
            <MenuRow
              label={item.label}
              hint={item.hint}
              title={titles?.[item.id]}
              icon={<ItemIcon size={16} />}
              active={index === active}
              disabled={!itemEnabled(item.id, flags)}
              onHover={() => onHoverRow(index)}
              onActivate={() => onActivateRow(index)}
              buttonRef={(node) => {
                rowRefs.current[index] = node;
              }}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
