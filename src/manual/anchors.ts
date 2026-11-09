const SLUG_STRIP = /[^\p{L}\p{N}\s_-]/gu;

export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(SLUG_STRIP, '')
    .replace(/ /g, '-');
}

// GitHub's duplicate rule: the first "Foo" stays "foo", later ones become "foo-1", "foo-2", ...
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = githubSlug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
