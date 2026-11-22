import type { EventMethodName, InvokeMethodName } from '../shared/ipc.js';

export function buildPreloadSource(options?: {
  invokeChannels?: Record<InvokeMethodName, string>;
  eventChannels?: Record<EventMethodName, string>;
  voidEventKeys?: ReadonlySet<EventMethodName>;
}): string;
