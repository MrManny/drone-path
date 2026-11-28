import { ERR_RENDER_CANCELED, codedError } from 'drone-path-core/errors';

export function renderCanceledError(cause?: unknown): Error {
  return codedError(ERR_RENDER_CANCELED, { code: 'RENDER_CANCELED', cause });
}
