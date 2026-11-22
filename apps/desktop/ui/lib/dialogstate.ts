export type DialogId =
  | 'closed'
  | 'help'
  | 'about'
  | 'map-appearance'
  | 'settings'
  | 'export'
  | 'track-save'
  | 'update';

export type DialogEvent =
  | { type: 'openHelp' }
  | { type: 'openAbout' }
  | { type: 'openMapAppearance' }
  | { type: 'openSettings' }
  | { type: 'openExport' }
  | { type: 'openTrackSave' }
  | { type: 'updateReady' }
  | { type: 'close' }
  | { type: 'resetPlayerDialogs' };

function pinned(state: DialogId, busy: boolean): boolean {
  return busy || state === 'update';
}

export function isPlayerDialog(state: DialogId): boolean {
  return state === 'export' || state === 'track-save';
}

export function dialogReducer(
  state: DialogId,
  event: DialogEvent,
  busy = false,
): DialogId {
  switch (event.type) {
    case 'openHelp':
      return pinned(state, busy) ? state : 'help';
    case 'openAbout':
      return pinned(state, busy) ? state : 'about';
    case 'openSettings':
      return pinned(state, busy) ? state : 'settings';
    case 'openMapAppearance':
      return pinned(state, busy) ? state : 'map-appearance';
    case 'openExport':
      return pinned(state, busy) ? state : 'export';
    case 'openTrackSave':
      return pinned(state, busy) ? state : 'track-save';
    case 'updateReady':
      return state === 'closed' ? 'update' : state;
    case 'close':
      return busy ? state : 'closed';
    case 'resetPlayerDialogs':
      return isPlayerDialog(state) ? 'closed' : state;
  }
}
