import { describe, expect, it, vi } from 'vitest';

import { createCloseGuard } from '../src/closeguard.js';
import type { ExportOutcome } from '../src/exportjob.js';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeGuard(options: {
  running?: () => boolean;
  confirmStopExport?: () => Promise<boolean>;
  closeWindow?: () => boolean;
} = {}) {
  const cancelExport = vi.fn();
  const quitApp = vi.fn();
  const log = vi.fn();
  const closeWindow = vi.fn(options.closeWindow ?? (() => true));
  const confirmStopExport = vi.fn(options.confirmStopExport ?? (async () => false));
  const guard = createCloseGuard({
    isExportRunning: options.running ?? (() => false),
    cancelExport,
    confirmStopExport,
    closeWindow,
    quitApp,
    log,
  });
  return { guard, cancelExport, quitApp, log, closeWindow, confirmStopExport };
}

describe('createCloseGuard', () => {
  it('allows immediate close when no export is running', () => {
    const { guard, confirmStopExport } = makeGuard({ running: () => false });
    const event = { preventDefault: vi.fn() };
    guard.onWindowClose(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(confirmStopExport).not.toHaveBeenCalled();
  });

  it('cancels export and closes window on settlement when user confirms stop', async () => {
    let active = true;
    const { guard, cancelExport, closeWindow } = makeGuard({
      running: () => active,
      confirmStopExport: async () => true,
    });

    const event = { preventDefault: vi.fn() };
    guard.onWindowClose(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(guard.isPromptOpen()).toBe(true);

    await flushMicrotasks();
    expect(guard.isPromptOpen()).toBe(false);
    expect(guard.isPendingClose()).toBe(true);
    expect(cancelExport).toHaveBeenCalledTimes(1);

    active = false;
    const notify = vi.fn();
    const outcome: ExportOutcome = { status: 'canceled' };
    guard.onExportSettled(outcome, notify);
    expect(notify).toHaveBeenCalledWith(outcome);
    expect(guard.isPendingClose()).toBe(false);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicate close attempts while the confirmation prompt is open', async () => {
    let resolvePrompt!: (value: boolean) => void;
    const { guard, confirmStopExport } = makeGuard({
      running: () => true,
      confirmStopExport: () =>
        new Promise<boolean>((resolve) => {
          resolvePrompt = resolve;
        }),
    });

    const first = { preventDefault: vi.fn() };
    const second = { preventDefault: vi.fn() };
    guard.onWindowClose(first);
    guard.onWindowClose(second);
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(second.preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmStopExport).toHaveBeenCalledTimes(1);

    resolvePrompt(false);
    await flushMicrotasks();
    expect(guard.isPromptOpen()).toBe(false);
  });

  it('closes directly without setting pendingClose if export finishes before confirmation resolves', async () => {
    let active = true;
    let resolvePrompt!: (value: boolean) => void;
    const { guard, cancelExport, closeWindow } = makeGuard({
      running: () => active,
      confirmStopExport: () =>
        new Promise<boolean>((resolve) => {
          resolvePrompt = resolve;
        }),
    });

    guard.onWindowClose({ preventDefault: vi.fn() });
    active = false;
    guard.onExportSettled({ status: 'canceled' }, vi.fn());
    expect(closeWindow).not.toHaveBeenCalled();

    resolvePrompt(true);
    await flushMicrotasks();
    expect(guard.isPendingClose()).toBe(false);
    expect(cancelExport).not.toHaveBeenCalled();
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('resets prompt state and logs when confirmation rejects', async () => {
    const { guard, log, confirmStopExport } = makeGuard({
      running: () => true,
      confirmStopExport: async () => {
        throw new Error('dialog failed');
      },
    });

    guard.onWindowClose({ preventDefault: vi.fn() });
    await flushMicrotasks();

    expect(guard.isPromptOpen()).toBe(false);
    expect(guard.isPendingClose()).toBe(false);
    expect(log).toHaveBeenCalledWith('close guard dialog failed: dialog failed');
    expect(confirmStopExport).toHaveBeenCalledTimes(1);
  });

  it('defers quit on window-all-closed while an export is running', () => {
    let active = true;
    const { guard, cancelExport, quitApp } = makeGuard({
      running: () => active,
      closeWindow: () => false,
    });

    guard.onWindowAllClosed();
    expect(quitApp).not.toHaveBeenCalled();
    expect(cancelExport).toHaveBeenCalledTimes(1);
    expect(guard.isPendingClose()).toBe(true);

    active = false;
    guard.onExportSettled({ status: 'canceled' }, vi.fn());
    expect(guard.isPendingClose()).toBe(false);
    expect(quitApp).toHaveBeenCalledTimes(1);
  });
});
