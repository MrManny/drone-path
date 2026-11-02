// The auto-update prompt's phase: the download runs quietly in the background,
// the prompt appears once per session and an answered prompt never returns.
export type UpdatePhase = 'idle' | 'ready' | 'prompted' | 'restarting';

export type UpdateEvent =
  | { type: 'ready' }
  | { type: 'prompt' }
  | { type: 'restart' }
  | { type: 'restartFailed' };

export function updateReducer(phase: UpdatePhase, event: UpdateEvent): UpdatePhase {
  switch (event.type) {
    case 'ready':
      return phase === 'idle' ? 'ready' : phase;
    case 'prompt':
      return phase === 'ready' ? 'prompted' : phase;
    case 'restart':
      return phase === 'prompted' ? 'restarting' : phase;
    case 'restartFailed':
      return phase === 'restarting' ? 'prompted' : phase;
  }
}

// The prompt waits for a quiet UI: it never stacks onto another dialog or an
// export dialog pinned open by a running job.
export function shouldPrompt(phase: UpdatePhase, modalOpen: boolean): boolean {
  return phase === 'ready' && !modalOpen;
}
