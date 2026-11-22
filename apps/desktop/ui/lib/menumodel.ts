import { tEnglish } from '../../src/desktop-i18n/messages.js';
import type { Translate } from '../../src/desktop-i18n/messages.js';

export type MenuId = 'file' | 'view' | 'help';

export type MenuItemId =
  | 'open'
  | 'exportVideo'
  | 'exportTelemetry'
  | 'settings'
  | 'appSettings'
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

interface MenuItemDef {
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

export function menuBar(t: Translate): readonly MenuDef[] {
  return [
    {
      id: 'file',
      label: t('menumodel.file'),
      mnemonic: 'f',
      align: 'start',
      items: [
        { id: 'open', label: t('menumodel.open'), icon: 'folderOpen', hint: 'Ctrl+O' },
        { id: 'exportVideo', label: t('menumodel.exportVideo'), icon: 'export' },
        { id: 'exportTelemetry', label: t('menumodel.exportTelemetry'), icon: 'telemetry' },
        { id: 'exit', label: t('menumodel.exit'), icon: 'exit', separatorBefore: true },
      ],
    },
    {
      id: 'view',
      label: t('menumodel.view'),
      mnemonic: 'v',
      align: 'start',
      items: [
        { id: 'settings', label: t('menumodel.mapAppearance'), icon: 'settings' },
        { id: 'swap', label: t('menumodel.pictureInPicture'), icon: 'swap', hint: 'P' },
        { id: 'appSettings', label: t('settings.menu'), icon: 'settings', separatorBefore: true },
      ],
    },
    {
      id: 'help',
      label: t('menumodel.help'),
      mnemonic: 'h',
      align: 'end',
      items: [
        { id: 'documentation', label: t('menumodel.manual'), icon: 'help' },
        { id: 'about', label: t('menumodel.about'), icon: 'info', separatorBefore: true },
      ],
    },
  ];
}

export const MENU_BAR = menuBar(tEnglish);

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
      return flags.hasRecording && !flags.opening;
    case 'swap':
      return flags.hasRecording;
    case 'appSettings':
    case 'settings':
      // Map appearance applies to future exports, so it is live from startup.
      return true;
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
