import { execFile, spawn } from 'node:child_process';
import type { ChildProcess, ExecFileOptions, SpawnOptions } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface ToolOutput {
  stdout: string;
  stderr: string;
}

// One child-process seam for src/: command, argv and buffer budget pass
// through untouched, and the spawned error propagates unwrapped so each
// caller keeps its own { cause } wording.
// Hide the console window on Windows so GUI callers do not flash a terminal.
export async function runTool(
  command: string,
  args: readonly string[],
  opts?: ExecFileOptions,
): Promise<ToolOutput> {
  const result = await execFileAsync(command, args, { windowsHide: true, ...opts });
  return {
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? ''),
  };
}

export async function runToolBinary(
  command: string,
  args: readonly string[],
  opts?: ExecFileOptions,
): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    command, args, { windowsHide: true, ...opts, encoding: 'buffer' },
  );
  return stdout;
}

export function spawnTool(
  command: string,
  args: readonly string[],
  opts?: SpawnOptions,
): ChildProcess {
  return spawn(command, args, { windowsHide: true, ...opts });
}
