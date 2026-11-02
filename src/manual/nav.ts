// Navigation derivation: the manual's nav is the ordered link list of the
// index page (docs/user/README.md), with the index itself as the first entry.

import type { CompiledPage } from './markdown.js';
import type { ManualNavEntry } from './model.js';

export function navFromIndex(index: CompiledPage): ManualNavEntry[] {
  const nav: ManualNavEntry[] = [{ slug: index.slug, label: index.page.title }];
  const seen = new Set<string>([index.slug]);
  for (const link of index.refs.links) {
    if (seen.has(link.slug)) continue;
    seen.add(link.slug);
    nav.push({ slug: link.slug, label: link.label });
  }
  return nav;
}
