export type MenuId = 'file' | 'view' | 'help';

export type MenuItemId =
  | 'open'
  | 'exportVideo'
  | 'exportTelemetry'
  | 'settings'
  | 'exit'
  | 'swap'
  | 'documentation'
  | 'about';

export type MenuIconId =
  | 'folderOpen'
  | 'export'
  | 'telemetry'
  | 'settings'
  | 'exit'
  | 'swap'
  | 'help'
  | 'info';

export interface MenuItemDef {
  id: MenuItemId;
  label: string;
  icon: MenuIconId;
  /** Right-aligned shortcut hint, e.g. "Ctrl+O". */
  hint?: string;
  separatorBefore?: boolean;
}

export interface MenuDef {
  id: MenuId;
  label: string;
  /** Lower-case letter opening this menu behind Alt, e.g. "f" for File. */
  mnemonic: string;
  /** End-aligned menus hang right, like Help in Windows apps. */
  align: 'start' | 'end';
  items: MenuItemDef[];
}

export const MENU_BAR: readonly MenuDef[] = [
  {
    id: 'file',
    label: 'File',
    mnemonic: 'f',
    align: 'start',
    items: [
      { id: 'open', label: 'Open…', icon: 'folderOpen', hint: 'Ctrl+O' },
      { id: 'exportVideo', label: 'Export video…', icon: 'export' },
      { id: 'exportTelemetry', label: 'Export telemetry…', icon: 'telemetry' },
      { id: 'settings', label: 'Settings', icon: 'settings', separatorBefore: true },
      { id: 'exit', label: 'Exit', icon: 'exit', separatorBefore: true },
    ],
  },
  {
    id: 'view',
    label: 'View',
    mnemonic: 'v',
    align: 'start',
    items: [{ id: 'swap', label: 'Swap', icon: 'swap', hint: 'S' }],
  },
  {
    id: 'help',
    label: 'Help',
    mnemonic: 'h',
    align: 'end',
    items: [
      { id: 'documentation', label: 'Documentation', icon: 'help' },
      { id: 'about', label: 'About', icon: 'info', separatorBefore: true },
    ],
  },
];

export interface MenuFlags {
  hasRecording: boolean;
  opening: boolean;
}

export function itemEnabled(id: MenuItemId, flags: MenuFlags): boolean {
  switch (id) {
    case 'open':
      return !flags.opening;
    case 'exportVideo':
    case 'exportTelemetry':
    case 'settings':
    case 'swap':
      return flags.hasRecording;
    case 'exit':
    case 'documentation':
    case 'about':
      return true;
  }
}

export function menuOf(id: MenuId, defs: readonly MenuDef[] = MENU_BAR): MenuDef {
  const menu = defs.find((def) => def.id === id);
  if (!menu) throw new Error(`unknown menu: ${id}`);
  return menu;
}
