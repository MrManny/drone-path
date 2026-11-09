import { Marked } from 'marked';
import type { Token } from 'marked';

import { createSlugger } from './anchors.js';
import type { CompiledRefs, ImageRef, PageLink } from './links.js';
import { isExternalTarget, parseImageRef, parsePageLink } from './links.js';
import type { ManualHeading, ManualPage } from './model.js';

export interface CompiledPage {
  slug: string;
  page: ManualPage;
  refs: CompiledRefs;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function titleAttr(title: string | null | undefined): string {
  return title ? ` title="${escapeAttr(title)}"` : '';
}

export function compileMarkdown(source: string, slug: string): CompiledPage {
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

  // parser(lexer(...)) instead of parse(): the instance is synchronous, and
  // only the two-step form types the output as a plain string.
  const html = md.parser(md.lexer(source));
  const title = headings.find((h) => h.level === 1)?.text ?? '';
  return {
    slug,
    page: { slug, title, headings, html },
    refs: { links, images, unknown },
  };
}
