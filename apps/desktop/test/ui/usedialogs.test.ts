// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDialogs } from '../../ui/hooks/useDialogs.js';
import type { DialogEvent, DialogId } from '../../ui/lib/dialogstate.js';

afterEach(cleanup);

function mountDialogs(isBusy: (active: DialogId) => boolean = () => false) {
  const view = renderHook(
    ({ busyFn }: { busyFn: (active: DialogId) => boolean }) => useDialogs(busyFn),
    { initialProps: { busyFn: isBusy } },
  );
  const send = (event: DialogEvent): void => {
    act(() => {
      view.result.current.dispatchDialog(event);
    });
  };
  return { ...view, send };
}

describe('useDialogs', () => {
  it('starts closed and dismissible', () => {
    const { result } = mountDialogs();
    expect(result.current).toEqual({
      active: 'closed',
      modalOpen: false,
      dismissible: true,
      dispatchDialog: result.current.dispatchDialog,
    });
  });

  it.each<{ event: DialogEvent; active: DialogId }>([
    { event: { type: 'openHelp' }, active: 'help' },
    { event: { type: 'openAbout' }, active: 'about' },
    { event: { type: 'openMapAppearance' }, active: 'map-appearance' },
    { event: { type: 'openSettings' }, active: 'settings' },
    { event: { type: 'openExport' }, active: 'export' },
    { event: { type: 'openTrackSave' }, active: 'track-save' },
    { event: { type: 'updateReady' }, active: 'update' },
  ])('opens $active on $event.type and closes back to closed', ({ event, active }) => {
    const { result, send } = mountDialogs();
    send(event);
    expect(result.current.active).toBe(active);
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.dismissible).toBe(true);
    send({ type: 'close' });
    expect(result.current.active).toBe('closed');
    expect(result.current.modalOpen).toBe(false);
  });

  it('derives dismissible from the active operation busy predicate and locks close while busy', () => {
    let busy = false;
    const { result, rerender, send } = mountDialogs(() => busy);
    send({ type: 'openExport' });
    expect(result.current.dismissible).toBe(true);

    busy = true;
    rerender({ busyFn: () => busy });
    expect(result.current.dismissible).toBe(false);

    send({ type: 'close' });
    send({ type: 'openAbout' });
    expect(result.current.active).toBe('export');

    busy = false;
    rerender({ busyFn: () => busy });
    expect(result.current.dismissible).toBe(true);

    send({ type: 'close' });
    expect(result.current.modalOpen).toBe(false);
  });

  it('keeps the help overlay when updateReady arrives', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openHelp' });
    send({ type: 'updateReady' });
    expect(result.current.active).toBe('help');
  });

  it('keeps the update prompt when other dialogs ask to open', () => {
    const { result, send } = mountDialogs();
    send({ type: 'updateReady' });
    send({ type: 'openHelp' });
    send({ type: 'openExport' });
    expect(result.current.active).toBe('update');
    send({ type: 'close' });
    expect(result.current.modalOpen).toBe(false);
  });

  it('clears player-bound dialogs on resetPlayerDialogs even when busy', () => {
    const { result, send } = mountDialogs((active) => active === 'track-save');
    send({ type: 'openTrackSave' });
    expect(result.current.dismissible).toBe(false);
    send({ type: 'resetPlayerDialogs' });
    expect(result.current.active).toBe('closed');
    expect(result.current.modalOpen).toBe(false);
  });
});
