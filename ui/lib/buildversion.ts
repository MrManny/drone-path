/** Git-derived facts about the build, injected at build time. */
export interface BuildGit {
  /** Whether HEAD carried the v<version> release tag. */
  tagged: boolean;
  /** Short commit of HEAD, or null when git was unavailable at build time. */
  commit: string | null;
}

/**
 * MAJOR.MINOR.PATCH for formal releases, MAJOR.MINOR.PATCH+<short commit> for
 * every other build. The + segment is build metadata, so self-update still
 * compares by the base version.
 */
export function formatVersion(version: string, git: BuildGit | null): string {
  // A tagged release never carries a commit hash; without git facts there is
  // no hash to show, so the plain version stays.
  if (git === null || git.tagged || git.commit === null || git.commit === '') {
    return version;
  }
  return `${version}+${git.commit}`;
}
