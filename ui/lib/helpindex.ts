// The Help overlay shows the manual's pages twice on the home page: the left
// navigation and the index page's own list of links. The overlay drops the
// in-page list so every page is listed once; the sources on GitHub keep it.

/** Removes the index page's leading manual-link list (its table of contents). */
export function dropManualToc(html: string, navSlugs: readonly string[]): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nav = new Set(navSlugs);
  for (const list of doc.body.querySelectorAll('ol')) {
    const items = [...list.querySelectorAll('li')];
    const links = [...list.querySelectorAll('a')];
    if (links.length < 2 || items.length !== links.length) continue;
    const slugs = links.map((link) => link.getAttribute('data-manual-slug') ?? '');
    if (slugs.some((slug) => slug === '' || !nav.has(slug))) continue;
    if (new Set(slugs).size !== slugs.length) continue;
    list.remove();
    break;
  }
  return doc.body.innerHTML;
}
