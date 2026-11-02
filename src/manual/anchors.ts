// GitHub-compatible heading anchors: the same slug GitHub derives for a
// heading so in-repo links and in-app links resolve to the same anchor.

const SLUG_STRIP = /[^\p{L}\p{N}\s_-]/gu;

/** The anchor GitHub gives a heading of plain `text`. */
export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(SLUG_STRIP, '')
    .replace(/ /g, '-');
}

/**
 * Slugs one document's headings with GitHub's duplicate rule: the first
 * "Foo" stays "foo", later ones become "foo-1", "foo-2", ...
 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = githubSlug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
