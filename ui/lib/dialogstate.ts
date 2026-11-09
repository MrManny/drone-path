// Dialog visibility as one state machine: which dialog is open and whether it
// may be dismissed come from a single state, so Escape, the backdrop and the
// header close can never disagree. "help" is the user manual overlay.
// "export-form" covers every dismissable phase of the export dialog (form,
// done, canceled, error); a running job pins it as "export-running".
// "telemetry-save" is the compact Save telemetry JSON dialog (outcome or pick
// error); a write in flight pins it as "telemetry-saving", so a late failure
// can never close into silence. "update-prompt" is the auto-update restart
// prompt; it only opens over a quiet UI and is dismissable like help. The map
// appearance popover is not a dialog and lives outside this machine.
export type DialogState =
  | 'closed'
  | 'help'
  | 'export-form'
  | 'export-running'
  | 'telemetry-save'
  | 'telemetry-saving'
  | 'update-prompt';

export type DialogEvent =
  | { type: 'openHelp' }
  | { type: 'openExport' }
  | { type: 'openTelemetrySave' }
  | { type: 'telemetrySaveStarted' }
  | { type: 'telemetrySaveFinished' }
  | { type: 'exportStarted' }
  | { type: 'exportFinished' }
  | { type: 'updateReady' }
  | { type: 'close' };

/** The job-lifecycle slice the export modal feeds the machine. */
export type DialogRunEvent = Extract<DialogEvent, { type: 'exportStarted' | 'exportFinished' }>;

// Work is in flight: nothing may dismiss the dialog until it has settled.
function busy(state: DialogState): boolean {
  return state === 'export-running' || state === 'telemetry-saving';
}

// The states nothing else may open over: work is in flight or the update
// prompt is waiting for its answer.
function pinned(state: DialogState): boolean {
  return busy(state) || state === 'update-prompt';
}

export function dialogReducer(state: DialogState, event: DialogEvent): DialogState {
  switch (event.type) {
    case 'openHelp':
      return pinned(state) ? state : 'help';
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

// The one dismissal rule, for Escape, the backdrop and the header close.
export function canDismiss(state: DialogState): boolean {
  return !busy(state);
}
