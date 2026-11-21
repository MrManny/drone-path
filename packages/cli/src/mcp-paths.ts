import fs from 'node:fs';
import path from 'node:path';

const MAX_SYMLINK_DEPTH = 40;

function pathKey(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code;
}

/**
 * Resolves a path by canonicalizing its deepest existing ancestor via realpath
 * (following symlinks, including dangling symlinks) and reattaching remaining
 * non-existent segments so boundary checks defeat `..` and symlink escapes.
 */
export function canonicalizePath(
  targetPath: string,
  depth = 0,
  seen = new Set<string>(),
): string {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    throw new Error('path must not be empty');
  }
  if (targetPath.includes('\0')) {
    throw new Error('path contains null byte');
  }

  const absolute = path.resolve(targetPath);
  const pending: string[] = [];
  let current = absolute;

  for (;;) {
    try {
      const stat = fs.lstatSync(current);
      try {
        const real = fs.realpathSync(current);
        return pending.length > 0 ? path.join(real, ...pending) : real;
      } catch (err) {
        if (!isErrno(err, 'ENOENT') || !stat.isSymbolicLink()) {
          throw err;
        }
        if (depth >= MAX_SYMLINK_DEPTH || seen.has(current)) {
          throw new Error(`symlink loop detected while resolving path: ${targetPath}`, {
            cause: err,
          });
        }
        seen.add(current);
        const linkTarget = fs.readlinkSync(current);
        const resolvedTarget = path.resolve(path.dirname(current), linkTarget);
        const canonicalTarget = canonicalizePath(resolvedTarget, depth + 1, seen);
        return pending.length > 0 ? path.join(canonicalTarget, ...pending) : canonicalTarget;
      }
    } catch (err) {
      if (!isErrno(err, 'ENOENT')) {
        throw err;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return pending.length > 0 ? path.join(current, ...pending) : current;
      }
      pending.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function resolveAllowedRoots(roots?: readonly string[]): string[] {
  const candidates = roots && roots.length > 0 ? roots : [process.cwd()];
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const root of candidates) {
    if (typeof root !== 'string' || root.trim() === '') {
      throw new Error('allowed root must not be empty');
    }
    if (root.includes('\0')) {
      throw new Error('allowed root contains null byte');
    }
    const absolute = path.resolve(root);
    let canonical: string;
    try {
      canonical = fs.realpathSync(absolute);
    } catch (err) {
      throw new Error(`allowed root does not exist: ${root}`, { cause: err });
    }
    if (!fs.statSync(canonical).isDirectory()) {
      throw new Error(`allowed root is not a directory: ${root}`);
    }
    const key = pathKey(canonical);
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push(canonical);
    }
  }

  return resolved;
}

export function isPathWithinRoot(canonicalTarget: string, canonicalRoot: string): boolean {
  const rel = path.relative(pathKey(canonicalRoot), pathKey(canonicalTarget));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

export function isPathInAllowedRoots(
  targetPath: string,
  allowedRoots: readonly string[],
): boolean {
  try {
    const canonical = canonicalizePath(targetPath);
    return allowedRoots.some((root) => isPathWithinRoot(canonical, root));
  } catch {
    return false;
  }
}

export function assertPathInAllowedRoots(
  targetPath: string,
  allowedRoots: readonly string[],
): string {
  const canonical = canonicalizePath(targetPath);
  if (!allowedRoots.some((root) => isPathWithinRoot(canonical, root))) {
    throw new Error(`path is outside allowed roots: ${targetPath}`);
  }
  return canonical;
}

function sameInode(a: string, b: string): boolean {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  const statA = fs.statSync(a, { bigint: true });
  const statB = fs.statSync(b, { bigint: true });
  return statA.dev === statB.dev && statA.ino === statB.ino;
}

export function isSamePath(a: string, b: string): boolean {
  const canonicalA = canonicalizePath(a);
  const canonicalB = canonicalizePath(b);
  if (pathKey(canonicalA) === pathKey(canonicalB)) return true;
  return sameInode(canonicalA, canonicalB);
}

export function assertNotArchiveDb(outputPath: string, archiveDb: string): void {
  const protectedPaths = [
    archiveDb,
    `${archiveDb}-wal`,
    `${archiveDb}-shm`,
    `${archiveDb}-journal`,
  ];
  for (const target of protectedPaths) {
    if (isSamePath(outputPath, target)) {
      throw new Error('output path cannot overwrite the archive database');
    }
  }
}
