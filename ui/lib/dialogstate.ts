// Dialog visibility as one state machine: which dialog is open and whether it
// may be dismissed come from a single state, so Escape, the backdrop and the
// header close can never disagree. "help" is the user manual overlay.
// "export-form" covers every dismissable phase of the export dialog (form,
// done, canceled, error); a running job pins it as "export-running".
// "telemetry-save" is the compact Save telemetry JSON dialog (saving, done,
// error). "update-prompt" is the auto-update restart prompt; it only opens
// over a quiet UI and is dismissable like help. The map appearance popover is
// not a dialog and lives outside this machine.
export type DialogState =
  | 'closed'
  | 'help'
  | 'export-form'
  | 'export-running'
  | 'telemetry-save'
  | 'update-prompt';

export type DialogEvent =
  | { type: 'openHelp' }
  | { type: 'openExport' }
  | { type: 'openTelemetrySave' }
  | { type: 'exportStarted' }
  | { type: 'exportFinished' }
  | { type: 'updateReady' }
  | { type: 'close' };

/** The job-lifecycle slice the export modal feeds the machine. */
export type DialogRunEvent = Extract<DialogEvent, { type: 'exportStarted' | 'exportFinished' }>;

export function dialogReducer(state: DialogState, event: DialogEvent): DialogState {
  switch (event.type) {
    case 'openHelp':
      return state === 'export-running' || state === 'update-prompt' ? state : 'help';
    case 'openExport':
      return state === 'export-running' || state === 'update-prompt' ? state : 'export-form';
    case 'openTelemetrySave':
      return state === 'export-running' || state === 'update-prompt' ? state : 'telemetry-save';
    case 'exportStarted':
      return state === 'export-form' ? 'export-running' : state;
    case 'exportFinished':
      return state === 'export-running' ? 'export-form' : state;
    case 'updateReady':
      return state === 'closed' ? 'update-prompt' : state;
    case 'close':
      return state === 'export-running' ? state : 'closed';
  }
}

// The one dismissal rule, for Escape, the backdrop and the header close.
export function canDismiss(state: DialogState): boolean {
  return state !== 'export-running';
}
