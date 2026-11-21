import { INITIAL_PREPARE_PROGRESS } from 'drone-path-engine/plan';
import type { PrepareProgress } from 'drone-path-engine/plan';

export type PickState =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'preparing'; progress: PrepareProgress }
  | { kind: 'ready' }
  | { kind: 'canceled' }
  | { kind: 'error'; message: string };

export type PickEvent =
  | { type: 'pick' }
  | { type: 'preparing' }
  | { type: 'progress'; progress: PrepareProgress }
  | { type: 'picked' }
  | { type: 'canceled' }
  | { type: 'failed'; message: string }
  | { type: 'dismiss' };

export function pickReducer(state: PickState, event: PickEvent): PickState {
  switch (event.type) {
    case 'pick':
      return state.kind === 'picking' || state.kind === 'preparing' ? state : { kind: 'picking' };
    case 'preparing':
      return state.kind === 'picking'
        ? { kind: 'preparing', progress: INITIAL_PREPARE_PROGRESS }
        : state;
    case 'progress':
      return state.kind === 'preparing' ? { kind: 'preparing', progress: event.progress } : state;
    case 'picked':
      return { kind: 'ready' };
    case 'canceled':
      return { kind: 'canceled' };
    case 'failed':
      return { kind: 'error', message: event.message };
    case 'dismiss':
      return state.kind === 'error' || state.kind === 'canceled' ? { kind: 'idle' } : state;
  }
}
