import { describe, expect, it } from 'vitest';

import type { MenuItemId } from '../../ui/lib/menumodel.js';
import { MENU_BAR, itemEnabled, menuOf } from '../../ui/lib/menumodel.js';

describe('MENU_BAR', () => {
  it('lays out File, View and Help with their mnemonics', () => {
    expect(MENU_BAR.map((menu) => [menu.id, menu.label, menu.mnemonic, menu.align])).toEqual([
      ['file', 'File', 'f', 'start'],
      ['view', 'View', 'v', 'start'],
      ['help', 'Help', 'h', 'end'],
    ]);
  });

  it('lists the File items in acceptance order with separators', () => {
    expect(menuOf('file').items).toEqual([
      { id: 'open', label: 'Open…', icon: 'folderOpen', hint: 'Ctrl+O' },
      { id: 'exportVideo', label: 'Export video…', icon: 'export' },
      { id: 'exportTelemetry', label: 'Export telemetry…', icon: 'telemetry' },
      { id: 'settings', label: 'Map appearance…', icon: 'settings', separatorBefore: true },
      { id: 'exit', label: 'Exit', icon: 'exit', separatorBefore: true },
    ]);
  });

  it('offers Toggle PiP with its shortcut hint in View', () => {
    expect(menuOf('view').items).toEqual([
      { id: 'swap', label: 'Toggle PiP', icon: 'swap', hint: 'P' },
    ]);
  });

  it('offers Help and About in the Help menu, About under a separator', () => {
    expect(menuOf('help').items).toEqual([
      { id: 'documentation', label: 'Help', icon: 'help' },
      { id: 'about', label: 'About', icon: 'info', separatorBefore: true },
    ]);
  });

  it('gives every item a label and an icon', () => {
    const items = MENU_BAR.flatMap((menu) => menu.items);
    expect(items.filter((item) => !item.label || !item.icon)).toEqual([]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it('throws for an unknown menu id', () => {
    expect(() => menuOf('nope' as 'file')).toThrow('unknown menu: nope');
  });
});

interface FlagCase {
  name: string;
  id: MenuItemId;
  flags: { hasRecording: boolean; opening: boolean };
  want: boolean;
}

describe('itemEnabled', () => {
  it.for<FlagCase>([
    {
      name: 'everything is live with a loaded recording',
      id: 'exportVideo',
      flags: { hasRecording: true, opening: false },
      want: true,
    },
    ...(['exportVideo', 'exportTelemetry', 'swap'] as const).map(
      (id): FlagCase => ({
        name: `${id} needs a recording`,
        id,
        flags: { hasRecording: false, opening: false },
        want: false,
      }),
    ),
    ...(['exportVideo', 'exportTelemetry', 'swap'] as const).map(
      (id): FlagCase => ({
        name: `${id} stays live while a recording is opening`,
        id,
        flags: { hasRecording: true, opening: true },
        want: true,
      }),
    ),
    {
      name: 'Map appearance is live with no recording (#236)',
      id: 'settings',
      flags: { hasRecording: false, opening: false },
      want: true,
    },
    {
      name: 'Map appearance stays live while a recording is opening',
      id: 'settings',
      flags: { hasRecording: false, opening: true },
      want: true,
    },
    {
      name: 'Open is live when idle',
      id: 'open',
      flags: { hasRecording: false, opening: false },
      want: true,
    },
    {
      name: 'Open waits while a recording is opening',
      id: 'open',
      flags: { hasRecording: false, opening: true },
      want: false,
    },
    {
      name: 'Exit never disables',
      id: 'exit',
      flags: { hasRecording: false, opening: true },
      want: true,
    },
    {
      name: 'Help never disables',
      id: 'documentation',
      flags: { hasRecording: false, opening: true },
      want: true,
    },
    {
      name: 'About never disables',
      id: 'about',
      flags: { hasRecording: false, opening: true },
      want: true,
    },
  ])('$name', ({ id, flags, want }) => {
    expect(itemEnabled(id, flags)).toBe(want);
  });
});
