export interface UpdateController {
  restart(deps: { onError: (message: string) => void }): { ok: true } | { ok: false; error: string };
}

export interface InitUpdatesOptions {
  log: (message: string) => void;
  onReady: () => void;
}

export function initUpdates(options: InitUpdatesOptions): UpdateController | null;
