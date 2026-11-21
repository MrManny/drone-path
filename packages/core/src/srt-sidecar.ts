import fs from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

function sidecarName(videoPath: string): string {
  const base = path.basename(videoPath).replace(/\.[^.]+$/, '');
  return `${base.toLowerCase()}.srt`;
}

export function findSrtSidecar(videoPath: string): string | null {
  const dir = path.dirname(videoPath);
  const name = sidecarName(videoPath);
  for (const fileName of fs.readdirSync(dir)) {
    if (fileName.toLowerCase() === name) {
      return path.join(dir, fileName);
    }
  }
  return null;
}

async function readSidecars(dir: string): Promise<Map<string, string>> {
  const sidecars = new Map<string, string>();
  for (const name of await readdir(dir)) {
    const key = name.toLowerCase();
    if (key.endsWith('.srt') && !sidecars.has(key)) sidecars.set(key, path.join(dir, name));
  }
  return sidecars;
}

export function createSrtSidecarLookup(): (videoPath: string) => Promise<string | null> {
  const directories = new Map<string, Promise<Map<string, string>>>();
  return async (videoPath) => {
    const dir = path.dirname(videoPath);
    let sidecars = directories.get(dir);
    if (!sidecars) {
      sidecars = readSidecars(dir);
      directories.set(dir, sidecars);
    }
    return (await sidecars).get(sidecarName(videoPath)) ?? null;
  };
}
