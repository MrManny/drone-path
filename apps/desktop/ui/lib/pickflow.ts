import { classifyError, fromIpcFailure, structuredError } from '../../shared/errors.js';
import type { PickResult, UiSession } from '../../shared/ipc.js';
import type { PickEvent } from './pickstate.js';

interface PickFlowDeps {
  pickRecording(): Promise<PickResult>;
  getSession(): Promise<UiSession | null>;
}

async function pick(deps: PickFlowDeps): Promise<PickEvent | null> {
  const result = await deps.pickRecording();
  if (!result.ok) {
    return result.canceled
      ? { type: 'canceled' }
      : { type: 'failed', error: fromIpcFailure(result, 'UNKNOWN') };
  }
  return null;
}

async function loadSession(deps: PickFlowDeps): Promise<UiSession | PickEvent> {
  const session = await deps.getSession();
  return session ?? { type: 'failed', error: structuredError('NO_RECORDING') };
}

export async function pickRecordingFlow(
  deps: PickFlowDeps,
  commit: (session: UiSession) => void,
): Promise<PickEvent> {
  try {
    const picked = await pick(deps);
    if (picked !== null) return picked;
    const loaded = await loadSession(deps);
    if ('type' in loaded) return loaded;
    commit(loaded);
    return { type: 'picked' };
  } catch (e) {
    return { type: 'failed', error: classifyError(e, 'BACKEND_ERROR') };
  }
}
