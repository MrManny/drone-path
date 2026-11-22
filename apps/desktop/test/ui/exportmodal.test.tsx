// @vitest-environment jsdom
import { useState } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExportOutcome, UiSession } from '../../shared/ipc.js';
import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import type { EncodeSettings, ExportRequest, RenderConfig } from 'drone-path-engine/config';
import type { CaptureProgress } from 'drone-path-engine/render';
import type { ExportOutputPayload } from '../../ui/lib/backend.js';
import { initialExportState } from '../../ui/lib/exportstate.js';
import type { LoopState } from '../../ui/lib/loop.js';
import { frameRangeOf, resolveLoop } from '../../ui/lib/loop.js';
import { useExport } from '../../ui/hooks/useExport.js';
import { ExportModal } from '../../ui/components/ExportModal.js';

vi.mock('../../ui/components/ExportPreview.js', () => ({
  ExportPreview: ({
    config,
    size,
    frame,
    note,
  }: {
    config: RenderConfig;
    size: { width: number; height: number };
    frame: number;
    note?: boolean;
  }) => (
    <div
      data-testid="export-preview"
      data-codec={config.codec}
      data-size={`${size.width}x${size.height}`}
      data-frame={frame}
      data-note={note ? '1' : '0'}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { dronepath?: unknown }).dronepath;
});

const SESSION = {
  video: { src: 'app://bundle/media/video', fps: 30, frames: 300, width: 1280, height: 720 },
  durationSec: 10,
} as unknown as UiSession;

const SETTINGS: RenderConfig = { ...DEFAULT_CONFIG, width: 768, height: 768 };

const SUMMARY = {
  video: '/v.mp4',
  out: '/exports/a.mp4',
  status: 'ok' as const,
  elapsedSec: 4,
  frames: 120,
  fps: '30000/1001',
  width: 1280,
  height: 720,
};

type Phase = 'form' | 'running' | 'done';
type Outcome = 'error' | 'canceled';
type Scenario = Phase | Outcome;

const FOOTERS: Record<Phase, string[]> = {
  form: ['Cancel', 'Start export'],
  running: ['Cancel export'],
  done: ['Open video', 'Reveal in folder'],
};

// A settled run returns to the form, so its actions — retry among them —
// stay one click away (#282).
const OUTCOME_FOOTERS: Record<Outcome, string[]> = {
  error: ['Cancel', 'Start export'],
  canceled: ['Cancel', 'Start export'],
};

function installBridge(overrides: Partial<Record<string, unknown>> = {}) {
  const listeners: {
    capture?: (progress: CaptureProgress) => void;
    done?: (outcome: ExportOutcome) => void;
  } = {};
  const bridge = {
    pickExportOutput: vi.fn(async () => ({ ok: true, path: '/exports/a.mp4' })),
    startExport: vi.fn(async (_request: ExportRequest) => ({ ok: true })),
    cancelExport: vi.fn(async () => ({ ok: true })),
    revealExportOutput: vi.fn(async (_payload: ExportOutputPayload) => ({ ok: true })),
    openExportOutput: vi.fn(async (_payload: ExportOutputPayload) => ({ ok: true })),
    onExportCapture: vi.fn((cb: (progress: CaptureProgress) => void) => {
      listeners.capture = cb;
      return () => {};
    }),
    onExportDone: vi.fn((cb: (outcome: ExportOutcome) => void) => {
      listeners.done = cb;
      return () => {};
    }),
    ...overrides,
  };
  (window as { dronepath?: unknown }).dronepath = bridge;
  return {
    bridge,
    emitCapture: (progress: CaptureProgress) => {
      act(() => {
        listeners.capture?.(progress);
      });
    },
    emitDone: (outcome: ExportOutcome) => {
      act(() => {
        listeners.done?.(outcome);
      });
    },
  };
}

function Harness({
  loop,
  onEncoderChange,
  settings = SETTINGS,
  initialSizes,
  onCloseCalled,
}: {
  loop: LoopState;
  onEncoderChange?: (patch: Partial<EncodeSettings>) => void;
  settings?: RenderConfig;
  initialSizes?: { width: number; height: number } | null;
  onCloseCalled?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const exportFlow = useExport(
    initialExportState(
      initialSizes?.width ?? settings.width,
      initialSizes?.height ?? settings.height,
      (() => {
        const points = resolveLoop(loop, SESSION.video.frames - 1);
        return points ? frameRangeOf(points) : null;
      })(),
    ),
  );
  if (!open || !exportFlow.state) return null;
  const dismissible = !exportFlow.busy;
  return (
    <ExportModal
      session={SESSION}
      settings={settings}
      loop={loop}
      state={exportFlow.state}
      dismissible={dismissible}
      onDispatch={exportFlow.dispatch}
      onStart={(segment) => exportFlow.start(settings, segment)}
      onCancel={exportFlow.cancel}
      onRunDone={exportFlow.runDone}
      onEncoderChange={onEncoderChange ?? (() => {})}
      onClose={() => {
        onCloseCalled?.();
        if (!dismissible) return;
        exportFlow.close();
        setOpen(false);
      }}
    />
  );
}

function renderModal(
  loop: LoopState,
  onEncoderChange?: (patch: Partial<EncodeSettings>) => void,
  settings?: RenderConfig,
  onCloseCalled?: () => void,
) {
  return render(
    <Harness
      loop={loop}
      onEncoderChange={onEncoderChange}
      settings={settings}
      onCloseCalled={onCloseCalled}
    />,
  );
}

async function reachPhase(phase: Scenario, emitDone: (outcome: ExportOutcome) => void) {
  renderModal({ in: null, out: null });
  if (phase === 'form') return;
  fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
  await screen.findByRole('button', { name: 'Cancel export' });
  if (phase === 'running') return;
  if (phase === 'done') emitDone({ status: 'ok', summary: SUMMARY });
  if (phase === 'error') {
    emitDone({
      status: 'error',
      code: 'FS_EXISTS',
      params: { name: 'blocked-folder' },
      detail: "EEXIST: file already exists, mkdir '/exports/blocked-folder'",
    });
  }
  if (phase === 'canceled') emitDone({ status: 'canceled' });
}

function dialogFooter(): HTMLElement | null {
  return screen.getByRole('dialog', { name: 'Export video' }).querySelector('.dialog-actions');
}

function headerClose(): HTMLButtonElement {
  const header = screen.getByRole('dialog', { name: 'Export video' }).querySelector('.settings-header') as HTMLElement;
  return within(header).getByRole<HTMLButtonElement>('button', { name: 'Close' });
}

describe('ExportModal form memory', () => {
  it('opens on the engaged segment', () => {
    render(<Harness loop={{ in: 300, out: 360 }} />);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /In–Out segment/ }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Full recording/ }).checked).toBe(false);
  });

  it('opens on the half-open segment for a lone in point (#245)', () => {
    render(<Harness loop={{ in: 100, out: null }} />);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /In–Out segment/ }).checked).toBe(true);
    expect(screen.getByText(/In–Out segment \(0:03–0:10 · 200 frames\)/)).toBeTruthy();
  });

  it('opens on the half-open segment for a lone out point (#245)', () => {
    render(<Harness loop={{ in: null, out: 150 }} />);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /In–Out segment/ }).checked).toBe(true);
    expect(screen.getByText(/In–Out segment \(0:00–0:05 · 151 frames\)/)).toBeTruthy();
  });

  it('offers no segment choice without a loop', () => {
    render(<Harness loop={{ in: null, out: null }} />);
    expect(screen.queryByRole('group', { name: 'Export range' })).toBeNull();
  });

  it('seeds the sizes from the session', () => {
    render(<Harness loop={{ in: null, out: null }} initialSizes={{ width: 1024, height: 576 }} />);
    expect(screen.getByLabelText<HTMLInputElement>('Width').value).toBe('1024');
    expect(screen.getByLabelText<HTMLInputElement>('Height').value).toBe('576');
  });

  it('commits every size edit in its effective form', () => {
    render(<Harness loop={{ in: null, out: null }} />);
    const width = screen.getByLabelText<HTMLInputElement>('Width');
    fireEvent.change(width, { target: { value: '769' } });
    fireEvent.blur(width);
    expect(width.value).toBe('768');
  });

  it('exports the frames marked at confirm when the loop moved under the dialog', async () => {
    const { bridge } = installBridge();
    const view = render(<Harness loop={{ in: 300, out: 360 }} />);
    view.rerender(<Harness loop={{ in: 60, out: 120 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0].range).toEqual({ start: 60, end: 120 });
  });
});

describe('ExportModal encoder choices', () => {
  it('starts the form from the persisted encoder settings', () => {
    renderModal(
      { in: null, out: null },
      undefined,
      { ...SETTINGS, codec: 'h265', quality: 'low', preset: 'veryfast' },
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Codec').value).toBe('h265');
    expect(screen.getByLabelText<HTMLSelectElement>('Quality').value).toBe('low');
    expect(screen.getByLabelText<HTMLSelectElement>('Encoding preset').value).toBe('veryfast');
  });

  it('reports encoder edits for the page to persist', () => {
    const onEncoderChange = vi.fn();
    renderModal({ in: null, out: null }, onEncoderChange);
    fireEvent.change(screen.getByLabelText('Codec'), { target: { value: 'h265' } });
    expect(onEncoderChange).toHaveBeenCalledWith({ codec: 'h265' });
  });

  it('clears a form error on an encoder edit', async () => {
    installBridge({
      startExport: vi.fn(async () => ({
        ok: false,
        code: 'EXPORT_ALREADY_RUNNING',
        detail: 'an export is already running',
      })),
    });
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('Quality'), { target: { value: 'low' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('carries the encoder settings into the export request', async () => {
    const { bridge } = installBridge();
    renderModal(
      { in: null, out: null },
      undefined,
      { ...SETTINGS, codec: 'h265', quality: 'low', preset: 'veryfast' },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0].config).toMatchObject({
      codec: 'h265',
      quality: 'low',
      preset: 'veryfast',
    });
  });
});

describe('ExportModal what-to-export choice', () => {
  it('does not offer a segment choice when no loop is engaged', () => {
    installBridge();
    renderModal({ in: null, out: null });
    expect(screen.queryByRole('group', { name: 'Export range' })).toBeNull();
    expect(screen.queryByText(/set loop points first/)).toBeNull();
  });

  it('offers the segment choice once a loop is engaged', () => {
    installBridge();
    renderModal({ in: 10, out: 29 });
    expect(screen.getByRole('radio', { name: /In–Out segment/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Full recording/ })).toBeTruthy();
  });
});

describe('ExportModal save-first flow', () => {
  it('opens the save dialog on Start export and starts nothing when it is cancelled', async () => {
    const { bridge } = installBridge({
      pickExportOutput: vi.fn(async () => ({ ok: false, canceled: true })),
    });
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.pickExportOutput).toHaveBeenCalledTimes(1));
    expect(bridge.startExport).not.toHaveBeenCalled();
  });

  it('starts the export with the chosen path once the dialog returns one', async () => {
    const { bridge } = installBridge();
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0]).toMatchObject({
      outPath: '/exports/a.mp4',
      range: null,
    });
  });

  it('exports the full recording when a stale segment is no longer engaged', async () => {
    const { bridge } = installBridge();
    const { rerender } = renderModal({ in: 10, out: 29 });
    fireEvent.click(screen.getByRole('radio', { name: /In–Out segment/ }));
    rerender(<Harness loop={{ in: null, out: null }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0].range).toBeNull();
  });

  it('exports the resolved half-open range for a lone point (#245)', async () => {
    const { bridge } = installBridge();
    renderModal({ in: 100, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0].range).toEqual({ start: 100, end: 299 });
  });
});

describe.each<Phase>(['form', 'running', 'done'])(
  'ExportModal footer in the %s phase',
  (phase) => {
    it('offers exactly the actions of that phase', async () => {
      const { emitDone } = installBridge();
      await reachPhase(phase, emitDone);
      const footer = dialogFooter();
      const labels = footer
        ? [...footer.querySelectorAll('button')].map((b) => b.textContent?.trim())
        : [];
      expect(labels).toEqual(FOOTERS[phase]);
      const dialog = screen.getByRole('dialog', { name: 'Export video' });
      expect(footer).toBe(dialog.lastElementChild);
      expect(footer?.previousElementSibling?.classList.contains('export-body')).toBe(true);
      const primaryLabels = [...(footer?.querySelectorAll('.dialog-primary') ?? [])].map(
        (button) => button.textContent?.trim(),
      );
      expect(primaryLabels).toEqual(
        phase === 'form' ? ['Start export'] : phase === 'done' ? ['Reveal in folder'] : [],
      );
    });
  },
);

describe.each<Outcome>(['error', 'canceled'])(
  'ExportModal footer after a %s run',
  (outcome) => {
    it('returns to the form actions instead of dead-ending (#282)', async () => {
      const { emitDone } = installBridge();
      await reachPhase(outcome, emitDone);
      const footer = dialogFooter();
      const labels = footer
        ? [...footer.querySelectorAll('button')].map((b) => b.textContent?.trim())
        : [];
      expect(labels).toEqual(OUTCOME_FOOTERS[outcome]);
    });
  },
);

describe.each<Scenario>(['form', 'done', 'error', 'canceled'])(
  'ExportModal header Close in the %s state',
  (scenario) => {
    it('stays enabled', async () => {
      const { emitDone } = installBridge();
      await reachPhase(scenario, emitDone);
      expect(headerClose().disabled).toBe(false);
    });
  },
);

describe('ExportModal while an export runs', () => {
  it('requests cancellation once and keeps the last progress level while waiting', async () => {
    const { bridge, emitCapture, emitDone } = installBridge();
    await reachPhase('running', emitDone);
    emitCapture({ done: 1, total: 2 });
    const cancel = screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel export' });
    fireEvent.click(cancel);

    expect(bridge.cancelExport).toHaveBeenCalledTimes(1);
    expect(cancel.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Canceling…');
    expect(document.querySelector('.phase-status')?.textContent).toBe('Canceling…');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  });

  it('disables the header Close and says why', async () => {
    const { emitDone } = installBridge();
    await reachPhase('running', emitDone);
    await waitFor(() => expect(headerClose().disabled).toBe(true));
    expect(headerClose().getAttribute('title')).toBe('Export is running. Cancel it to close.');
  });
});

describe('ExportModal dismissal', () => {
  it('closes the form through Cancel', () => {
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Export video' })).toBeNull();
  });

  it('ignores a backdrop click while the job runs', async () => {
    const { emitDone } = installBridge();
    await reachPhase('running', emitDone);
    await waitFor(() => expect(headerClose().disabled).toBe(true));
    fireEvent.click(screen.getByRole('dialog', { name: 'Export video' }).parentElement as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'Export video' })).toBeTruthy();
  });

  it('closes on a backdrop click once the job has settled', async () => {
    const { emitDone } = installBridge();
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    expect(headerClose().disabled).toBe(true);
    emitDone({ status: 'canceled' });
    await screen.findByRole('button', { name: 'Start export' });
    expect(headerClose().disabled).toBe(false);
    fireEvent.click(screen.getByRole('dialog', { name: 'Export video' }).parentElement as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Export video' })).toBeNull();
  });
});

describe('ExportModal busy locking', () => {
  it('derives dismissible directly from the running phase without effect lag', async () => {
    const { emitDone } = installBridge();
    renderModal({ in: null, out: null });
    expect(headerClose().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    expect(headerClose().disabled).toBe(true);
    emitDone({ status: 'canceled' });
    await screen.findByRole('button', { name: 'Start export' });
    expect(headerClose().disabled).toBe(false);
  });
});

describe('ExportModal outcomes', () => {
  it('reports a finished export with its frame rate in decimal fps', async () => {
    const { emitDone } = installBridge();
    await reachPhase('done', emitDone);
    expect(screen.getByText('120 frames @ 29.97 fps · 4 s · 1280×720')).toBeTruthy();
  });

  it('shows the media duration, never the encode wall time (#284)', async () => {
    const { emitDone } = installBridge();
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    emitDone({ status: 'ok', summary: { ...SUMMARY, frames: 361, elapsedSec: 9 } });
    expect(screen.getByText('361 frames @ 29.97 fps · 12 s · 1280×720')).toBeTruthy();
    expect(screen.queryByText(/9 s/)).toBeNull();
  });

  it('drops the rate and duration clauses when the summary carries no frame rate', async () => {
    const { emitDone } = installBridge();
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    emitDone({ status: 'ok', summary: { ...SUMMARY, fps: undefined } });
    expect(screen.getByText('120 frames · 1280×720')).toBeTruthy();
  });

  it('turns a raw Node error into a sentence and keeps the original as details', async () => {
    const { emitDone } = installBridge();
    await reachPhase('error', emitDone);
    expect(screen.getByText(/A file named "blocked-folder" is in the way\./)).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText("EEXIST: file already exists, mkdir '/exports/blocked-folder'")).toBeTruthy();
  });

  it('says a canceled export removed its working file', async () => {
    const { emitDone } = installBridge();
    await reachPhase('canceled', emitDone);
    expect(screen.getByText('Export canceled; its unfinished file was removed.')).toBeTruthy();
  });
});

describe('ExportModal done action payloads', () => {
  it('sends Reveal in folder the exported path of the kept render', async () => {
    const { bridge, emitDone } = installBridge();
    await reachPhase('done', emitDone);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in folder' }));
    expect(bridge.revealExportOutput.mock.calls[0][0]).toEqual({ out: '/exports/a.mp4' });
  });

  it('sends Open video the exported path of the kept render', async () => {
    const { bridge, emitDone } = installBridge();
    await reachPhase('done', emitDone);
    fireEvent.click(screen.getByRole('button', { name: 'Open video' }));
    expect(bridge.openExportOutput.mock.calls[0][0]).toEqual({ out: '/exports/a.mp4' });
  });

  it('shows a failed reveal in place until a retry clears it', async () => {
    const { bridge, emitDone } = installBridge({
      revealExportOutput: vi.fn(async () => ({
        ok: false,
        code: 'FS_ACCESS_DENIED',
        params: { name: 'a.mp4' },
        detail: "EACCES: permission denied, open '/exports/a.mp4'",
      })),
    });
    await reachPhase('done', emitDone);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in folder' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Access to "a.mp4" was denied.');
    bridge.revealExportOutput.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in folder' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('ExportModal dimension fields commit the effective size (#94)', () => {
  it.for<{ label: string; typed: string; committed: string }>([
    { label: 'Width', typed: '769', committed: '768' },
    { label: 'Height', typed: '765', committed: '764' },
  ])('$label: typing $typed and blurring shows $committed', ({ label, typed, committed }) => {
    installBridge();
    renderModal({ in: null, out: null });
    const input = screen.getByLabelText<HTMLInputElement>(label, { exact: true });
    fireEvent.change(input, { target: { value: typed } });
    fireEvent.blur(input);
    expect(input.value).toBe(committed);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Must be at least 64 px.')).toBeNull();
  });

  it('sends the committed sizes in the export request', async () => {
    const { bridge } = installBridge();
    renderModal({ in: null, out: null });
    const width = screen.getByLabelText<HTMLInputElement>('Width', { exact: true });
    const height = screen.getByLabelText<HTMLInputElement>('Height', { exact: true });
    fireEvent.change(width, { target: { value: '769' } });
    fireEvent.change(height, { target: { value: '765' } });
    fireEvent.blur(width);
    fireEvent.blur(height);
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0].config).toMatchObject({ width: 768, height: 764 });
  });

  it('keeps the done summary consistent with the committed size', async () => {
    const { emitDone } = installBridge();
    renderModal({ in: null, out: null });
    const width = screen.getByLabelText<HTMLInputElement>('Width', { exact: true });
    fireEvent.change(width, { target: { value: '769' } });
    fireEvent.blur(width);
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    emitDone({ status: 'ok', summary: { ...SUMMARY, width: 768, height: 768 } });
    expect(screen.getByText('120 frames @ 29.97 fps · 4 s · 768×768')).toBeTruthy();
  });

  it.for<{ typed: string; label: string }>([
    { typed: '10', label: 'a below-minimum value' },
    { typed: '', label: 'a non-finite value' },
  ])('drops $label on blur and shows the last valid size', ({ typed }) => {
    installBridge();
    renderModal({ in: null, out: null });
    const width = screen.getByLabelText<HTMLInputElement>('Width', { exact: true });
    fireEvent.change(width, { target: { value: typed } });
    expect(screen.getByText('Must be at least 64 px.')).toBeTruthy();
    fireEvent.blur(width);
    expect(screen.queryByText('Must be at least 64 px.')).toBeNull();
    expect(width.value).toBe('768');
    expect(width.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('ExportModal rainy paths', () => {
  it('shows a start failure in the form and keeps the form usable', async () => {
    installBridge({
      startExport: vi.fn(async () => ({
        ok: false,
        code: 'EXPORT_ALREADY_RUNNING',
        detail: 'an export is already running',
      })),
    });
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    expect(
      await screen.findByText('An export is already running. Wait for it to finish or cancel it.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start export' })).toBeTruthy();
  });

  it('marks a width below the minimum with a message that names the rule', () => {
    installBridge();
    renderModal({ in: null, out: null });
    const width = screen.getByLabelText<HTMLInputElement>('Width', { exact: true });
    fireEvent.change(width, { target: { value: '10' } });
    expect(screen.getByText('Must be at least 64 px.')).toBeTruthy();
    expect(width.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a failed Reveal in folder in the done phase', async () => {
    const { emitDone } = installBridge({
      revealExportOutput: vi.fn(async () => ({
        ok: false,
        code: 'FS_ACCESS_DENIED',
        params: { name: 'a.mp4' },
        detail: "EACCES: permission denied, open '/exports/a.mp4'",
      })),
    });
    await reachPhase('done', emitDone);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in folder' }));
    expect(
      await screen.findByText('Access to "a.mp4" was denied. Choose a location you can write to.'),
    ).toBeTruthy();
  });

  it('re-enables Cancel export and says why when the cancel is refused', async () => {
    const { emitDone } = installBridge({
      cancelExport: vi.fn(async () => ({
        ok: false,
        code: 'EXPORT_COULD_NOT_BE_CANCELED',
        detail: 'export could not be canceled',
      })),
    });
    await reachPhase('running', emitDone);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    expect(await screen.findByText('The export could not be canceled. Try again.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel export' }).disabled).toBe(false);
  });

  it('shows the reason when the cancel request itself fails', async () => {
    const { emitDone } = installBridge({
      cancelExport: vi.fn(async () => {
        throw new Error('the app backend went away');
      }),
    });
    await reachPhase('running', emitDone);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    expect(await screen.findByText('BACKEND_ERROR: the app backend went away')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel export' }).disabled).toBe(false);
  });
});

describe.each<Phase>(['form', 'running', 'done'])(
  'ExportModal output preview in the %s phase',
  (phase) => {
    it('shows what the export contains', async () => {
      const { emitDone } = installBridge();
      await reachPhase(phase, emitDone);
      expect(screen.getByTestId('export-preview')).toBeTruthy();
    });
  },
);

describe.each<Outcome>(['canceled', 'error'])(
  'ExportModal output preview after a %s run',
  (outcome) => {
    it('comes back with the returned form (#282)', async () => {
      const { emitDone } = installBridge();
      await reachPhase(outcome, emitDone);
      expect(screen.getByTestId('export-preview')).toBeTruthy();
    });
  },
);

describe('ExportModal output preview content', () => {
  it('stands on the middle of the chosen range', () => {
    render(<Harness loop={{ in: 60, out: 120 }} />);
    const preview = screen.getByTestId('export-preview');
    expect(preview.getAttribute('data-frame')).toBe('90');
    fireEvent.click(screen.getByRole('radio', { name: /Full recording/ }));
    expect(preview.getAttribute('data-frame')).toBe('150');
  });

  it('previews the committed output size', () => {
    render(
      <Harness loop={{ in: null, out: null }} settings={{ ...SETTINGS, width: 1024, height: 576 }} />,
    );
    expect(screen.getByTestId('export-preview').getAttribute('data-size')).toBe('1024x576');
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '769' } });
    expect(screen.getByTestId('export-preview').getAttribute('data-size')).toBe('768x576');
  });

  it('freezes on the request look while the job runs', async () => {
    installBridge();
    const { rerender } = render(
      <Harness loop={{ in: null, out: null }} settings={{ ...SETTINGS, codec: 'h264' }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    expect(screen.getByTestId('export-preview').getAttribute('data-codec')).toBe('h264');
    rerender(<Harness loop={{ in: null, out: null }} settings={{ ...SETTINGS, codec: 'h265' }} />);
    expect(screen.getByTestId('export-preview').getAttribute('data-codec')).toBe('h264');
  });
});

describe('ExportModal phase lead', () => {
  const liveStatus = (): HTMLElement =>
    document.querySelector('.export-phase > [role="status"]') as HTMLElement;

  it('leads the done dialog with the success sentence before the stats', async () => {
    const { emitDone } = installBridge();
    await reachPhase('done', emitDone);
    const column = document.querySelector('.export-phase') as HTMLElement;
    expect(liveStatus().textContent).toBe('Export finished.');
    expect(column.firstElementChild?.textContent).toBe('Export finished.');
  });

  it('announces the phase text in one persistent status region', async () => {
    const { emitDone } = installBridge();
    renderModal({ in: null, out: null });
    const status = liveStatus();
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    expect(status.textContent).toBe('Preparing…');
    emitDone({ status: 'ok', summary: SUMMARY });
    await waitFor(() => expect(status.textContent).toBe('Export finished.'));
    expect(liveStatus()).toBe(status);
  });

  it('leaves the status line empty when the form carries the outcome notice', async () => {
    const { emitDone } = installBridge();
    await reachPhase('canceled', emitDone);
    const visible = document.querySelector('.phase-status') as HTMLElement;
    expect(visible.textContent).toBe('');
    expect(liveStatus().textContent).toBe('');
  });

  it('keeps visible percent continuous while throttling role="status" announcements to 25% quartiles (#408)', async () => {
    const { emitCapture, emitDone } = installBridge();
    renderModal({ in: null, out: null });
    const visible = document.querySelector('.phase-status') as HTMLElement;
    const status = liveStatus();
    expect(visible.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    expect(status.textContent).toBe('Preparing…');

    const observed: string[] = [];
    const observer = new MutationObserver(() => {
      observed.push(status.textContent ?? '');
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });

    emitCapture({ done: 12, total: 100 });
    await Promise.resolve();
    expect(visible.textContent).toBe('Exporting 12%');
    expect(status.textContent).toBe('Exporting 0%');

    for (const done of [0, 1, 10, 24]) {
      emitCapture({ done, total: 100 });
      await Promise.resolve();
      expect(visible.textContent).toBe(`Exporting ${done}%`);
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(String(done));
    }
    expect(status.textContent).toBe('Exporting 0%');

    for (const done of [25, 49, 50, 83]) {
      emitCapture({ done, total: 100 });
      await Promise.resolve();
      expect(visible.textContent).toBe(`Exporting ${done}%`);
    }

    observer.disconnect();
    expect(observed).toEqual(['Exporting 0%', 'Exporting 25%', 'Exporting 50%', 'Exporting 75%']);
    emitDone({ status: 'ok', summary: SUMMARY });
    await waitFor(() => expect(status.textContent).toBe('Export finished.'));
    expect(visible.textContent).toBe('Export finished.');
  });
});

describe('ExportModal focus on phase changes', () => {
  it('moves focus to the new phase action and never to <body>', async () => {
    const { emitDone } = installBridge();
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel export' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    emitDone({ status: 'ok', summary: SUMMARY });
    const reveal = await screen.findByRole('button', { name: 'Reveal in folder' });
    await waitFor(() => expect(document.activeElement).toBe(reveal));
    expect(document.activeElement).not.toBe(document.body);
  });

  it.for<Outcome>(['error', 'canceled'])(
    'returns focus to Start export after a %s run (#282)',
    async (outcome) => {
      const { emitDone } = installBridge();
      await reachPhase(outcome, emitDone);
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start export' })),
      );
      expect(document.activeElement).not.toBe(document.body);
    },
  );

  it('returns focus to Start export when the job fails to start', async () => {
    installBridge({
      // The real IPC ack lands in a later task, so the running phase commits
      // before the failure returns the form.
      startExport: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return {
          ok: false,
          code: 'EXPORT_ALREADY_RUNNING',
          detail: 'an export is already running',
        };
      }),
    });
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByText('An export is already running. Wait for it to finish or cancel it.');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start export' })),
    );
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('ExportModal terminal outcomes return to the form (#282)', () => {
  it('keeps the failure sentence in place and retries on the next click', async () => {
    const { bridge, emitDone } = installBridge();
    await reachPhase('error', emitDone);
    expect(screen.getByText(/A file named "blocked-folder" is in the way\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(2));
  });

  it('carries the cancel sentence as a status notice, not an alert', async () => {
    const { emitDone } = installBridge();
    await reachPhase('canceled', emitDone);
    const notice = screen
      .getByText('Export canceled; its unfinished file was removed.')
      .closest('.notice');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ExportModal map-only note', () => {
  it('shows the rule at the form phase only, once per flow', async () => {
    const { emitDone } = installBridge();
    renderModal({ in: null, out: null });
    expect(screen.getByTestId('export-preview').getAttribute('data-note')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    expect(screen.getByTestId('export-preview').getAttribute('data-note')).toBe('0');
    emitDone({ status: 'ok', summary: SUMMARY });
    await screen.findByRole('button', { name: 'Reveal in folder' });
    expect(screen.getByTestId('export-preview').getAttribute('data-note')).toBe('0');
  });
});

describe('ExportModal save-picker guards (#313)', () => {
  it('ignores duplicate Start export triggers while the save picker is open and unlocks after cancel', async () => {
    let resolvePick: (result: { ok: boolean; canceled?: boolean; path?: string }) => void = () => {};
    const { bridge } = installBridge({
      pickExportOutput: vi.fn(
        () =>
          new Promise((resolve) => {
            resolvePick = resolve;
          }),
      ),
    });
    renderModal({ in: null, out: null });
    const startButton = screen.getByRole('button', { name: 'Start export' });
    fireEvent.click(startButton);
    fireEvent.click(startButton);
    expect(bridge.pickExportOutput).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePick({ ok: false, canceled: true });
    });

    fireEvent.click(startButton);
    expect(bridge.pickExportOutput).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolvePick({ ok: true, path: '/exports/a.mp4' });
    });
    expect(bridge.startExport).toHaveBeenCalledTimes(1);
  });

  it('aborts without starting an export if the modal closes while the save picker is open', async () => {
    let resolvePick: (result: { ok: boolean; path?: string }) => void = () => {};
    const { bridge } = installBridge({
      pickExportOutput: vi.fn(
        () =>
          new Promise((resolve) => {
            resolvePick = resolve;
          }),
      ),
    });
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    expect(bridge.pickExportOutput).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Export video' })).toBeNull();

    await act(async () => {
      resolvePick({ ok: true, path: '/exports/a.mp4' });
    });
    expect(bridge.startExport).not.toHaveBeenCalled();
  });
});
