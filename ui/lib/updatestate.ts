export type UpdatePhase = 'idle' | 'ready' | 'prompted' | 'restarting';

export interface UpdateState {
  phase: UpdatePhase;
  /** Backend message of a failed restart, shown under "Technical details". */
  failure: string | null;
}

export type UpdateEvent =
  | { type: 'ready' }
  | { type: 'prompt' }
  | { type: 'restart' }
  | { type: 'restartFailed'; message: string };

export const INITIAL_UPDATE: UpdateState = { phase: 'idle', failure: null };

export function updateReducer(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'ready':
      return state.phase === 'idle' ? { ...state, phase: 'ready' } : state;
    case 'prompt':
      return state.phase === 'ready' ? { ...state, phase: 'prompted' } : state;
    case 'restart':
      return state.phase === 'prompted' ? { phase: 'restarting', failure: null } : state;
    case 'restartFailed':
      // Back to the prompt, keeping the failure message so the dialog can
      // report what happened instead of silently reverting.
      return state.phase === 'restarting'
        ? { phase: 'prompted', failure: event.message }
        : state;
  }
}

export function shouldPrompt(phase: UpdatePhase, modalOpen: boolean): boolean {
  return phase === 'ready' && !modalOpen;
}
