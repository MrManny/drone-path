import { codedError, errorMessage } from 'drone-path-core/errors';
import type { ErrorParams } from 'drone-path-core/errors';

export type { ErrorParams };

export type DesktopErrorCode =
  | 'NO_RECORDING'
  | 'PICK_IN_PROGRESS'
  | 'NOT_READABLE_MP4'
  | 'EXPORT_ALREADY_RUNNING'
  | 'EXPORT_COULD_NOT_START'
  | 'EXPORT_COULD_NOT_BE_CANCELED'
  | 'OUTPUT_OVERWRITES_SOURCE'
  | 'OUTPUT_PATH_ABSOLUTE'
  | 'OUTPUT_NOT_APPROVED'
  | 'UNKNOWN_OUTPUT'
  | 'COULD_NOT_REPLACE_OUTPUT'
  | 'APP_BRIDGE_UNAVAILABLE'
  | 'ACTION_FAILED'
  | 'TRACK_SAVE_FAILED'
  | 'REVEAL_FAILED'
  | 'OPEN_FAILED'
  | 'INVALID_LANGUAGE'
  | 'INVALID_REQUEST'
  | 'UPDATES_UNAVAILABLE'
  | 'UPDATE_RESTART_FAILED'
  | 'NO_FRAME_RATE'
  | 'NO_TELEMETRY'
  | 'RENDER_CANCELED'
  | 'OUTPUT_VERIFICATION'
  | 'FS_EXISTS'
  | 'FS_NOT_FOUND'
  | 'FS_ACCESS_DENIED'
  | 'FS_DISK_FULL'
  | 'FS_BUSY'
  | 'FS_IS_DIRECTORY'
  | 'ARCHIVE_SCAN_RUNNING'
  | 'ARCHIVE_SCAN_CANCELED'
  | 'ARCHIVE_ROOT_INVALID'
  | 'ARCHIVE_CLIP_OFFLINE'
  | 'ARCHIVE_EXPORT_FAILED'
  | 'BACKEND_ERROR'
  | 'UNKNOWN';

// Uncataloged backend/system error codes (for example EIO or SQLITE_BUSY) pass
// through verbatim as strings rather than collapsing to UNKNOWN.
export type AppErrorCode = DesktopErrorCode | (string & {});

export interface StructuredError {
  code: AppErrorCode;
  detail?: string;
  params?: ErrorParams;
}

const NODE_ERRNO_MAP: Readonly<Record<string, DesktopErrorCode>> = {
  EEXIST: 'FS_EXISTS',
  ENOENT: 'FS_NOT_FOUND',
  EACCES: 'FS_ACCESS_DENIED',
  EPERM: 'FS_ACCESS_DENIED',
  ENOSPC: 'FS_DISK_FULL',
  EBUSY: 'FS_BUSY',
  EISDIR: 'FS_IS_DIRECTORY',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readParams(value: unknown): ErrorParams | undefined {
  if (!isRecord(value) || Array.isArray(value)) return undefined;
  const out: Record<string, string | number> = {};
  let hasEntry = false;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      out[key] = entry;
      hasEntry = true;
    }
  }
  return hasEntry ? out : undefined;
}

export function leafName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

export function structuredError(
  code: AppErrorCode,
  detail?: string,
  params?: ErrorParams,
): StructuredError {
  return {
    code,
    ...(detail !== undefined && detail !== '' ? { detail } : {}),
    ...(params !== undefined ? { params } : {}),
  };
}

export function fromIpcFailure(
  failure: { code?: AppErrorCode; detail?: string; params?: ErrorParams },
  fallbackCode: AppErrorCode = 'UNKNOWN',
): StructuredError {
  return structuredError(failure.code ?? fallbackCode, failure.detail, failure.params);
}

export function codedDesktopError(
  code: DesktopErrorCode,
  detail: string,
  params?: ErrorParams,
  cause?: unknown,
): Error {
  return codedError(detail, { code, params, cause });
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

export function isStructuredError(value: unknown): value is StructuredError {
  return (
    isRecord(value) &&
    !(value instanceof Error) &&
    typeof value.code === 'string' &&
    value.code.length > 0
  );
}

export function classifyError(
  error: unknown,
  fallbackCode: AppErrorCode = 'BACKEND_ERROR',
): StructuredError {
  if (isStructuredError(error)) {
    const detail = typeof error.detail === 'string' ? error.detail : undefined;
    return structuredError(error.code, detail, readParams(error.params));
  }
  const detail = error === undefined || error === null ? '' : errorMessage(error);
  const chain = causeChain(error);

  for (const node of chain) {
    if (!isRecord(node) || typeof node.code !== 'string' || node.code.length === 0) continue;
    const fsCode = NODE_ERRNO_MAP[node.code];
    if (fsCode) {
      const rawPath = typeof node.dest === 'string' && node.dest.length > 0
        ? node.dest
        : typeof node.path === 'string' && node.path.length > 0
          ? node.path
          : null;
      const params = rawPath !== null ? { name: leafName(rawPath) } : undefined;
      return structuredError(fsCode, detail, params);
    }
    return structuredError(node.code, detail, readParams(node.params));
  }

  for (const node of chain) {
    if (isRecord(node) && node.name === 'ZodError') {
      return structuredError('INVALID_REQUEST', detail);
    }
  }

  return structuredError(fallbackCode, detail);
}
