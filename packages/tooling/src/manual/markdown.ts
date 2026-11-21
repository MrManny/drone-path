import { Marked } from 'marked';
import type { Token, TokensList } from 'marked';

import type { CompiledRefs, ImageRef, PageLink } from './links.js';
import { isExternalTarget, parseImageRef, parsePageLink } from './links.js';
import type { ManualHeading, ManualPage } from './model.js';

export interface CompiledPage {
  slug: string;
  page: ManualPage;
  refs: CompiledRefs;
}

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

/** Angle brackets only — for help text that carries no entities (the CLI
    reference renders these as literal angle brackets). */
export function escapeAngleBrackets(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
  return escapeAngleBrackets(value.replace(/&/g, '&amp;'));
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function inlineText(tokens: readonly Token[] | undefined): string {
  if (!tokens) return '';
  let out = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape':
      case 'codespan':
        out += token.text;
        break;
      case 'image':
        out += token.text;
        break;
      case 'br':
        out += ' ';
        break;
      case 'html':
      case 'tag':
        break;
      default:
        if ('tokens' in token && token.tokens) out += inlineText(token.tokens);
    }
  }
  return out;
}

function collectLinkHrefs(tokens: readonly Token[] | undefined, out: string[] = []): string[] {
  if (!tokens) return out;
  for (const token of tokens) {
    if (token.type === 'link' && typeof token.href === 'string') {
      out.push(token.href);
    } else if ('tokens' in token && Array.isArray(token.tokens)) {
      collectLinkHrefs(token.tokens, out);
    }
  }
  return out;
}

function isManualTocList(token: Token, slug: string, navSlugs: ReadonlySet<string>): boolean {
  if (token.type !== 'list' || !token.ordered) return false;
  const items = token.items as ReadonlyArray<{ tokens?: readonly Token[] }>;
  if (items.length < 2) return false;
  const slugs: string[] = [];
  for (const item of items) {
    const hrefs = collectLinkHrefs(item.tokens);
    if (hrefs.length !== 1) return false;
    const target = parsePageLink(hrefs[0], slug);
    if (!target || !navSlugs.has(target.slug)) return false;
    slugs.push(target.slug);
  }
  return new Set(slugs).size === slugs.length;
}

// The Help overlay renders the page list in its left navigation; dropping the
// index page's leading TOC at compile time keeps every page listed once while
// docs/user/README.md stays intact on GitHub.
function stripLeadingToc(
  tokens: TokensList,
  slug: string,
  navSlugs: ReadonlySet<string>,
): TokensList {
  let dropped = false;
  const kept = tokens.filter((token) => {
    if (!dropped && isManualTocList(token, slug, navSlugs)) {
      dropped = true;
      return false;
    }
    return true;
  });
  return Object.assign(kept, { links: tokens.links });
}

function titleAttr(title: string | null | undefined): string {
  return title ? ` title="${escapeAttr(title)}"` : '';
}

export function compileMarkdown(
  source: string,
  slug: string,
  options?: { dropToc?: ReadonlySet<string> },
): CompiledPage {
  const slugger = createSlugger();
  const headings: ManualHeading[] = [];
  const links: PageLink[] = [];
  const images: ImageRef[] = [];
  const unknown: string[] = [];

  const md = new Marked({ gfm: true, breaks: false });
  md.use({
    renderer: {
      heading({ tokens, depth }): string {
        const text = inlineText(tokens);
        const id = slugger(text);
        headings.push({ id, text, level: depth });
        return `<h${depth} id="${escapeAttr(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      link({ href, title, tokens }): string {
        const inner = this.parser.parseInline(tokens);
        const label = inlineText(tokens);
        if (isExternalTarget(href)) {
          return `<a href="${escapeAttr(href)}"${titleAttr(title)} target="_blank" rel="noopener noreferrer">${inner}</a>`;
        }
        const target = parsePageLink(href, slug);
        if (!target) {
          unknown.push(href);
          return `<a href="${escapeAttr(href)}"${titleAttr(title)}>${inner}</a>`;
        }
        links.push({ raw: href, label, slug: target.slug, anchor: target.anchor });
        const anchor = target.anchor === null ? '' : ` data-manual-anchor="${escapeAttr(target.anchor)}"`;
        return `<a href="#manual/${escapeAttr(target.slug)}"${anchor} data-manual-slug="${escapeAttr(target.slug)}"${titleAttr(title)}>${inner}</a>`;
      },
      image({ href, title, text }): string {
        const file = parseImageRef(href);
        if (!file) {
          unknown.push(href);
          return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}"${titleAttr(title)}>`;
        }
        images.push({ raw: href, file });
        return `<img src="/manual/images/${escapeAttr(file)}" alt="${escapeAttr(text)}"${titleAttr(title)}>`;
      },
      html({ text }): string {
        // Comments disappear like on GitHub; any other raw HTML is escaped.
        return /^<!--[\s\S]*-->$/.test(text) ? '' : escapeHtml(text);
      },
    },
  });

  // Two-step form instead of parse(): only parser(lexer(...)) types the output as a plain string.
  const lexed = md.lexer(source);
  const tokens = options?.dropToc ? stripLeadingToc(lexed, slug, options.dropToc) : lexed;
  const html = md.parser(tokens);
  const title = headings.find((h) => h.level === 1)?.text ?? '';
  return {
    slug,
    page: { slug, title, headings, html },
    refs: { links, images, unknown },
  };
}
