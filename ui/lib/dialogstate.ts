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
  | { type: 'telemetrySaveStarted' }
  | { type: 'telemetrySaveFinished' }
  | { type: 'exportStarted' }
  | { type: 'exportFinished' }
  | { type: 'updateReady' }
  | { type: 'close' };

export type DialogRunEvent = Extract<DialogEvent, { type: 'exportStarted' | 'exportFinished' }>;

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
    case 'telemetrySaveStarted':
      return state === 'telemetry-save' ? 'telemetry-saving' : state;
    case 'telemetrySaveFinished':
      return state === 'telemetry-saving' ? 'telemetry-save' : state;
    case 'exportStarted':
      return state === 'export-form' ? 'export-running' : state;
    case 'exportFinished':
      return state === 'export-running' ? 'export-form' : state;
    case 'updateReady':
      return state === 'closed' ? 'update-prompt' : state;
    case 'close':
      return busy(state) ? state : 'closed';
  }
}

export function canDismiss(state: DialogState): boolean {
  return !busy(state);
}
