// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDialogs } from '../../ui/hooks/useDialogs.js';
import type { DialogEvent } from '../../ui/lib/dialogstate.js';

afterEach(cleanup);

function mountDialogs() {
  const { result } = renderHook(() => useDialogs());
  const send = (event: DialogEvent): void => {
    act(() => {
      result.current.dispatchDialog(event);
    });
  };
  return { result, send };
}

describe('useDialogs', () => {
  it('starts closed', () => {
    const { result } = mountDialogs();
    expect(result.current).toEqual({
      modalOpen: false,
      helpOpen: false,
      aboutOpen: false,
      exportOpen: false,
      telemetrySaveOpen: false,
      updateOpen: false,
      dismissible: true,
      dispatchDialog: result.current.dispatchDialog,
    });
  });

  it('opens the export dialog', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openExport' });
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.exportOpen).toBe(true);
    expect(result.current.dismissible).toBe(true);
  });

  it('pins the dialog and refuses dismissal while a job runs', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openExport' });
    send({ type: 'exportStarted' });
    expect(result.current.exportOpen).toBe(true);
    expect(result.current.dismissible).toBe(false);
  });

  it('ignores close while a job runs', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openExport' });
    send({ type: 'exportStarted' });
    send({ type: 'close' });
    expect(result.current.exportOpen).toBe(true);
    expect(result.current.dismissible).toBe(false);
  });

  it('returns to the form and allows dismissal when the job finishes', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openExport' });
    send({ type: 'exportStarted' });
    send({ type: 'exportFinished' });
    expect(result.current.exportOpen).toBe(true);
    expect(result.current.dismissible).toBe(true);
    send({ type: 'close' });
    expect(result.current.modalOpen).toBe(false);
  });

  it('opens the telemetry save dialog as a dismissable modal', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openTelemetrySave' });
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.telemetrySaveOpen).toBe(true);
    expect(result.current.dismissible).toBe(true);
  });

  it('pins the telemetry save dialog while the write runs and releases it on the outcome', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openTelemetrySave' });
    send({ type: 'telemetrySaveStarted' });
    expect(result.current.telemetrySaveOpen).toBe(true);
    expect(result.current.dismissible).toBe(false);
    send({ type: 'close' });
    expect(result.current.telemetrySaveOpen).toBe(true);
    send({ type: 'telemetrySaveFinished' });
    expect(result.current.dismissible).toBe(true);
    send({ type: 'close' });
    expect(result.current.modalOpen).toBe(false);
  });

  it('opens the help overlay as a dismissable modal', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openHelp' });
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.helpOpen).toBe(true);
    expect(result.current.dismissible).toBe(true);
  });

  it('opens the About dialog as a dismissable modal', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openAbout' });
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.aboutOpen).toBe(true);
    expect(result.current.dismissible).toBe(true);
    send({ type: 'close' });
    expect(result.current.aboutOpen).toBe(false);
    expect(result.current.modalOpen).toBe(false);
  });

  it('keeps a running job between About and the workspace', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openExport' });
    send({ type: 'exportStarted' });
    send({ type: 'openAbout' });
    expect(result.current.aboutOpen).toBe(false);
    expect(result.current.exportOpen).toBe(true);
  });

  it('closes an open dialog', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openHelp' });
    send({ type: 'close' });
    expect(result.current.modalOpen).toBe(false);
    expect(result.current.helpOpen).toBe(false);
  });

  it('keeps the help overlay when the update prompt wants to open', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openHelp' });
    send({ type: 'updateReady' });
    expect(result.current.helpOpen).toBe(true);
    expect(result.current.updateOpen).toBe(false);
  });

  it('opens the update prompt as a dismissable modal', () => {
    const { result, send } = mountDialogs();
    send({ type: 'updateReady' });
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.updateOpen).toBe(true);
    expect(result.current.dismissible).toBe(true);
  });

  it('keeps the update prompt when other dialogs ask to open', () => {
    const { result, send } = mountDialogs();
    send({ type: 'updateReady' });
    send({ type: 'openHelp' });
    expect(result.current.updateOpen).toBe(true);
    send({ type: 'openExport' });
    expect(result.current.updateOpen).toBe(true);
    send({ type: 'close' });
    expect(result.current.modalOpen).toBe(false);
  });
});
