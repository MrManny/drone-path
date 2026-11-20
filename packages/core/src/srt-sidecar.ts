import fs from 'node:fs';
import path from 'node:path';

export function findSrtSidecar(videoPath: string): string | null {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath).replace(/\.[^.]+$/, '');
  const sidecarName = `${base.toLowerCase()}.srt`;
  for (const fileName of fs.readdirSync(dir)) {
    if (fileName.toLowerCase() === sidecarName) {
      return path.join(dir, fileName);
    }
  }
  return null;
}
