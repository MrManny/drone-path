import { homedir } from 'node:os';
import path from 'node:path';

export function archiveDbPath(override?: string): string {
  if (override !== undefined) return path.resolve(override);
  const xdgData = process.env['XDG_DATA_HOME'];
  const unixData = xdgData !== undefined && path.isAbsolute(xdgData)
    ? xdgData
    : path.join(homedir(), '.local', 'share');
  const base = process.platform === 'win32'
    ? process.env['LOCALAPPDATA'] ?? path.join(homedir(), 'AppData', 'Local')
    : process.platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Application Support')
      : unixData;
  return path.join(base, 'drone-path', 'archive.sqlite');
}
