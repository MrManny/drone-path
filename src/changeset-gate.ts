const PR_TITLE_NEEDS_CHANGESET = /^(feat|fix)(\([^)]+\))?!?:/;

const PR_TITLE_NEEDS_CHANGELOG = /^release(\([^)]+\))?:/;

const CHANGESET_FRAGMENT_PATH = /^\.changeset\/([^/]+)\.md$/;

const CHANGELOG_PATH = /^CHANGELOG\.md$/;

export type GateOutcome = { ok: true; note: string } | { ok: false; error: string };

export function prNeedsChangeset(prTitle: string): boolean {
  return PR_TITLE_NEEDS_CHANGESET.test(prTitle.trim());
}

export function prNeedsChangelogUpdate(prTitle: string): boolean {
  return PR_TITLE_NEEDS_CHANGELOG.test(prTitle.trim());
}

export function prNeedsArtifact(prTitle: string): boolean {
  return prNeedsChangeset(prTitle) || prNeedsChangelogUpdate(prTitle);
}

export function hasChangesetFragment(changedPaths: readonly string[]): boolean {
  return changedPaths.some((path) => {
    const match = CHANGESET_FRAGMENT_PATH.exec(path);
    return match !== null && match[1].toLowerCase() !== 'readme';
  });
}

export function hasChangelogUpdate(changedPaths: readonly string[]): boolean {
  return changedPaths.some((path) => CHANGELOG_PATH.test(path));
}

export function evaluateGate(prTitle: string, changedPaths: readonly string[]): GateOutcome {
  const title = prTitle.trim();
  if (prNeedsChangeset(title)) {
    return hasChangesetFragment(changedPaths)
      ? { ok: true, note: `changeset: fragment found for '${title}'` }
      : {
          ok: false,
          error: `'${title}' must add a .changeset/*.md fragment (see .changeset/README.md)`,
        };
  }
  if (prNeedsChangelogUpdate(title)) {
    return hasChangelogUpdate(changedPaths)
      ? { ok: true, note: `changeset: CHANGELOG.md updated for '${title}'` }
      : { ok: false, error: `'${title}' must change CHANGELOG.md` };
  }
  return { ok: true, note: `changeset: '${title}' requires no changelog artifact` };
}
