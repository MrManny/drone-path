import { execFile } from 'node:child_process';
import type { ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface ToolOutput {
  stdout: string;
  stderr: string;
}

// One child-process seam for src/: command, argv and buffer budget pass
// through untouched, and the spawned error propagates unwrapped so each
// caller keeps its own { cause } wording. Tool output is text (utf8).
export async function runTool(
  command: string,
  args: readonly string[],
  opts?: ExecFileOptions,
): Promise<ToolOutput> {
  const result = await execFileAsync(command, args, opts);
  return {
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? ''),
  };
}
