import type { ExportRequest, FrameRange, RenderConfig } from '../../src/config.js';
import {
  ERR_EXPORT_COULD_NOT_BE_CANCELED,
  ERR_EXPORT_COULD_NOT_START,
  errorMessage,
} from '../../src/errors.js';
import type { ExportAck, ExportOutputPayload, PickOutputResult } from './backend.js';
import type { ExportEvent, ExportForm } from './exportstate.js';

export interface ExportFlowDeps {
  pickExportOutput(): Promise<PickOutputResult>;
  startExport(request: ExportRequest): Promise<ExportAck>;
  cancelExport(): Promise<ExportAck>;
  revealExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
  openExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
}

/** What the form holds when the flow runs; the request derives from it. */
export interface ExportFlowInput {
  settings: RenderConfig;
  form: ExportForm;
  segment: { range: FrameRange } | null;
}

type EmitExportEvent = (event: ExportEvent) => void;

function buildRequest(input: ExportFlowInput, outPath: string): ExportRequest {
  return {
    outPath,
    config: { ...input.settings, width: input.form.width, height: input.form.height },
    range: input.segment && input.form.range ? input.segment.range : null,
  };
}

async function runBridgeAction<T extends ExportAck>(
  call: () => Promise<T>,
  onFailure: (error: string) => ExportEvent,
  emit: EmitExportEvent,
  fallback?: string,
): Promise<T | null> {
  try {
    const ack = await call();
    if (!ack.ok) {
      const refused = ack.error ?? fallback;
      if (refused) emit(onFailure(refused));
    }
    return ack;
  } catch (e) {
    emit(onFailure(errorMessage(e)));
    return null;
  }
}

async function pickDestination(
  deps: ExportFlowDeps,
  emit: EmitExportEvent,
): Promise<string | null> {
  const picked = await runBridgeAction(
    () => deps.pickExportOutput(),
    (error) => ({ type: 'failed', error }),
    emit,
  );
  return picked?.ok && picked.path ? picked.path : null;
}

async function startJob(
  deps: ExportFlowDeps,
  request: ExportRequest,
  emit: EmitExportEvent,
): Promise<void> {
  emit({ type: 'start', request });
  await runBridgeAction(
    () => deps.startExport(request),
    (error) => ({ type: 'startFailed', error }),
    emit,
    ERR_EXPORT_COULD_NOT_START,
  );
}

export async function chooseAndExport(
  deps: ExportFlowDeps,
  input: ExportFlowInput,
  emit: EmitExportEvent,
): Promise<void> {
  const outPath = await pickDestination(deps, emit);
  if (outPath === null) return;
  emit({ type: 'choose', path: outPath });
  await startJob(deps, buildRequest(input, outPath), emit);
}

export function cancelExport(deps: ExportFlowDeps, emit: EmitExportEvent): void {
  emit({ type: 'cancelRequested' });
  void runBridgeAction(
    () => deps.cancelExport(),
    (error) => ({ type: 'cancelFailed', error }),
    emit,
    ERR_EXPORT_COULD_NOT_BE_CANCELED,
  );
}

export function runDoneAction(
  deps: ExportFlowDeps,
  call: (deps: ExportFlowDeps) => Promise<ExportAck>,
  emit: EmitExportEvent,
): void {
  emit({ type: 'clearError' });
  void runBridgeAction(
    () => call(deps),
    (error) => ({ type: 'failed', error }),
    emit,
    'action failed',
  );
}
