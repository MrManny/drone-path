// Manual reference rules: what an internal link or image may point at, and
// the pure validation that keeps the checked-in corpus consistent. The
// compiler rewrites what parses here; validation then proves every reference
// resolves inside the corpus.

import type { ManualPage } from './model.js';

export interface PageLink {
  /** The raw Markdown target, kept for error messages. */
  raw: string;
  /** The link's plain-text label (the navigation label when indexed). */
  label: string;
  slug: string;
  anchor: string | null;
}

export interface ImageRef {
  raw: string;
  /** The file name under docs/images. */
  file: string;
}

export interface CompiledRefs {
  links: PageLink[];
  images: ImageRef[];
  /** Raw targets that match no known reference shape; validation rejects them. */
  unknown: string[];
}

const SCHEME_RX = /^[a-z][a-z0-9+.-]*:/i;

/** README.md is the index page "index"; foo.md is "foo". */
export function pageSlugOf(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base === 'README.md' ? 'index' : base.replace(/\.md$/, '');
}

/** True for links that leave the manual (web, mail). */
export function isExternalTarget(raw: string): boolean {
  return SCHEME_RX.test(raw);
}

export interface PageTarget {
  slug: string;
  anchor: string | null;
}

/**
 * Parses an internal Markdown link target: "foo.md", "foo.md#bar", "#bar"
 * (same page). Anything else returns null and counts as unknown.
 */
export function parsePageLink(raw: string, currentSlug: string): PageTarget | null {
  const [path, hash, ...rest] = raw.split('#');
  if (rest.length > 0) return null;
  const anchor = hash === undefined || hash === '' ? null : hash;
  if (path === '') return anchor === null ? null : { slug: currentSlug, anchor };
  const clean = path.startsWith('./') ? path.slice(2) : path;
  if (!clean.endsWith('.md') || clean.includes('/')) return null;
  return { slug: pageSlugOf(clean), anchor };
}

/** Parses an image target: "../images/foo.jpg" becomes "foo.jpg". */
export function parseImageRef(raw: string): string | null {
  const match = /^\.\.\/images\/([^/?#]+)$/.exec(raw);
  return match ? (match[1] ?? null) : null;
}

export interface CorpusIssue {
  file: string;
  message: string;
}

/**
 * Validates every reference of every compiled page against the corpus:
 * internal links resolve to a page, anchors to a heading in that page, images
 * to a file in `imageFiles`. Unknown targets are rejected outright.
 */
export function validateCorpus(
  pages: readonly { slug: string; page: ManualPage; refs: CompiledRefs }[],
  imageFiles: ReadonlySet<string>,
): CorpusIssue[] {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const issues: CorpusIssue[] = [];
  for (const { slug, refs } of pages) {
    const file = `docs/user/${sourceNameOf(slug)}`;
    for (const raw of refs.unknown) {
      issues.push({
        file,
        message: `link "${raw}" is neither a .md page link nor a web link; link pages as "other.md" or "other.md#anchor", and mention plain file paths in backticks`,
      });
    }
    for (const link of refs.links) {
      const target = bySlug.get(link.slug);
      if (!target) {
        issues.push({ file, message: `link "${link.raw}" points at missing page "${link.slug}.md"` });
        continue;
      }
      if (link.anchor !== null && !target.page.headings.some((h) => h.id === link.anchor)) {
        issues.push({
          file,
          message: `link "${link.raw}" points at missing anchor "#${link.anchor}" in "${sourceNameOf(link.slug)}"`,
        });
      }
    }
    for (const image of refs.images) {
      if (!imageFiles.has(image.file)) {
        issues.push({ file, message: `image "${image.raw}" points at missing file "docs/images/${image.file}"` });
      }
    }
  }
  return issues;
}

/** The Markdown file name a slug was compiled from. */
export function sourceNameOf(slug: string): string {
  return slug === 'index' ? 'README.md' : `${slug}.md`;
}
