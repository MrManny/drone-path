export const ERROR_PREFIX = '[drone-path] ERROR: ';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The backend-to-UI error protocol: ui/lib/errortext.ts builds its sentence
// patterns from these exact strings, so every producer spells its message
// through here — rewording one is greppable and cannot silently downgrade
// its UI sentence.
export const ERR_NO_RECORDING = 'no recording loaded';
export const ERR_EXPORT_ALREADY_RUNNING = 'an export is already running';
export const ERR_EXPORT_COULD_NOT_START = 'export could not start';
export const ERR_EXPORT_COULD_NOT_BE_CANCELED = 'export could not be canceled';
export const ERR_OUTPUT_OVERWRITES_SOURCE = 'the output must not overwrite the source recording';
export const ERR_OUTPUT_PATH_ABSOLUTE = 'output path must be absolute: ';
export const ERR_APP_BRIDGE_UNAVAILABLE = 'app bridge unavailable';
export const ERR_RENDER_CANCELED = 'render canceled';
export const ERR_NOT_READABLE_MP4 = 'not a readable .mp4 file: ';
export const ERR_NO_TELEMETRY = 'no telemetry found: ';
export const ERR_OUTPUT_VERIFICATION = 'output verification failed: ';
export const ERR_COULD_NOT_REPLACE = 'could not replace ';
export const ERR_RENDER_KEPT_AT = 'the finished render is at ';
export const ERR_NO_FRAME_RATE = 'could not determine the frame rate of the video';
export const ERR_UNKNOWN = 'unknown error';

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
