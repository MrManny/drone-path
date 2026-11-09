import path from 'node:path';

// Resolved so separator and `..` spellings of one file share a key;
// toLowerCase is locale-independent, so the key stays deterministic.
export function pathKey(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = platform === 'win32' ? path.win32.resolve(p) : path.posix.resolve(p);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return pathKey(a, platform) === pathKey(b, platform);
}

// First free name `stem.ext`, `stem-2.ext`, `stem-3.ext`, ... in dir. The
// caller says what "taken" means (names planned in this run, or files on
// disk); existing names are never reused or deleted.
export function uniquePath(
  dir: string,
  stem: string,
  ext: string,
  isTaken: (candidate: string) => boolean,
): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
    const candidate = path.join(dir, name);
    if (!isTaken(candidate)) return candidate;
  }
}
