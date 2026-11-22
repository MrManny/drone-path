export const ERROR_PREFIX = '[drone-path] ERROR: ';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type ErrorParams = Readonly<Record<string, string | number>>;

export interface CodedErrorOptions {
  code: string;
  params?: ErrorParams;
  cause?: unknown;
}

export function codedError(message: string, options: CodedErrorOptions): Error {
  const error = new Error(
    message,
    options.cause !== undefined ? { cause: options.cause } : undefined,
  ) as Error & { code: string; params?: ErrorParams };
  error.code = options.code;
  if (options.params !== undefined) error.params = options.params;
  return error;
}

// Core and engine domain error messages shared with CLI and desktop wrappers;
// desktop-only IPC/UI error codes live in apps/desktop/shared/errors.ts.
export const ERR_RENDER_CANCELED = 'render canceled';
export const ERR_NO_TELEMETRY = 'no telemetry found: ';
export const ERR_OUTPUT_VERIFICATION = 'output verification failed: ';
export const ERR_NO_FRAME_RATE = 'could not determine the frame rate of the video';

// The mandated failure shell for generated-art tool entries (AGENTS.md): one
// ERROR line on stderr and process.exitCode = 1, never a mid-flow exit.
export async function runToolMain(fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    process.stderr.write(`${ERROR_PREFIX}${errorMessage(e)}\n`);
    process.exitCode = 1;
  }
}
