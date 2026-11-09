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

export function shouldPrompt(phase: UpdatePhase, modalOpen: boolean): boolean {
  return phase === 'ready' && !modalOpen;
}
