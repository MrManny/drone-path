export type DialogState =
  | 'closed'
  | 'help'
  | 'about'
  | 'export-form'
  | 'export-running'
  | 'telemetry-save'
  | 'telemetry-saving'
  | 'update-prompt';

export type DialogEvent =
  | { type: 'openHelp' }
  | { type: 'openAbout' }
  | { type: 'openExport' }
  | { type: 'openTelemetrySave' }
  | { type: 'runStarted' }
  | { type: 'runFinished' }
  | { type: 'updateReady' }
  | { type: 'close' };

function busy(state: DialogState): boolean {
  return state === 'export-running' || state === 'telemetry-saving';
}

function pinned(state: DialogState): boolean {
  return busy(state) || state === 'update-prompt';
}

export function dialogReducer(state: DialogState, event: DialogEvent): DialogState {
  switch (event.type) {
    case 'openHelp':
      return pinned(state) ? state : 'help';
    case 'openAbout':
      return pinned(state) ? state : 'about';
    case 'openExport':
      return pinned(state) ? state : 'export-form';
    case 'openTelemetrySave':
      return pinned(state) ? state : 'telemetry-save';
    case 'runStarted':
      return state === 'export-form'
        ? 'export-running'
        : state === 'telemetry-save'
          ? 'telemetry-saving'
          : state;
    case 'runFinished':
      return state === 'export-running'
        ? 'export-form'
        : state === 'telemetry-saving'
          ? 'telemetry-save'
          : state;
    case 'updateReady':
      return state === 'closed' ? 'update-prompt' : state;
    case 'close':
      return busy(state) ? state : 'closed';
  }
}

export function canDismiss(state: DialogState): boolean {
  return !busy(state);
}
