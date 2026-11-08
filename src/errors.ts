export const ERROR_PREFIX = '[drone-path] ERROR: ';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
