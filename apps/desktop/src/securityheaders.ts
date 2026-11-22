import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { APP_ORIGIN } from '#shared/appurls.js';

export const X_CONTENT_TYPE_OPTIONS = 'nosniff';

const INLINE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const SRC_ATTR_RE = /(?:^|\s)src\s*=/i;

/** Extracts sorted unique SHA-256 CSP hashes for all non-empty inline scripts in HTML. */
export function extractInlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    if (SRC_ATTR_RE.test(attrs) || body.length === 0) continue;
    const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    hashes.add(`sha256-${digest}`);
  }
  return [...hashes].sort();
}

function walkHtmlFiles(dir: string, out: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      out.push(full);
    }
  }
}

/** Collects sorted unique SHA-256 script hashes across all static HTML files in an export root. */
export function collectExportScriptHashes(exportRoot: string): string[] {
  if (!fs.existsSync(exportRoot)) return [];
  const files: string[] = [];
  walkHtmlFiles(exportRoot, files);
  const hashes = new Set<string>();
  for (const file of files) {
    for (const hash of extractInlineScriptHashes(fs.readFileSync(file, 'utf8'))) {
      hashes.add(hash);
    }
  }
  return [...hashes].sort();
}

export interface RendererCspOptions {
  devUrl?: string | null;
  scriptHashes?: readonly string[];
}

const APP_URL = new URL(APP_ORIGIN);

function isAppOrigin(parsed: URL): boolean {
  // Custom schemes have an opaque "null" .origin in WHATWG URL, so match scheme + host directly.
  return (
    parsed.protocol === APP_URL.protocol &&
    parsed.host === APP_URL.host &&
    parsed.username === '' &&
    parsed.password === ''
  );
}

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** Builds the renderer Content-Security-Policy header value for packaged or dev mode. */
export function buildRendererCsp(options: RendererCspOptions = {}): string {
  const devUrl = options.devUrl ?? null;
  if (devUrl) {
    const parsed = new URL(devUrl);
    const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsOrigin = `${wsProtocol}//${parsed.host}`;
    return [
      "default-src 'self'",
      // Next.js dev mode uses eval/inline HMR chunks; production uses static script hashes.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' ${APP_ORIGIN} data: blob:`,
      `media-src 'self' ${APP_ORIGIN}`,
      "font-src 'self' data:",
      `connect-src 'self' ${wsOrigin} ${APP_ORIGIN}`,
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join('; ');
  }

  const hashes = [...new Set(options.scriptHashes ?? [])].sort();
  const scriptSources = ["'self'", ...hashes.map((hash) => `'${hash}'`)];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

/** Returns true when a response URL belongs to the app bundle or active dev server origin. */
export function shouldApplySecurityHeaders(url: string, devUrl: string | null = null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (isAppOrigin(parsed)) return true;
  const devOrigin = originOf(devUrl);
  return devOrigin !== null && parsed.origin === devOrigin;
}

/** Sets Content-Security-Policy and X-Content-Type-Options on a webRequest responseHeaders map. */
export function applySecurityHeaders(
  responseHeaders: Record<string, string[]>,
  csp: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(responseHeaders)) {
    const lower = name.toLowerCase();
    if (lower === 'content-security-policy' || lower === 'x-content-type-options') continue;
    next[name] = values;
  }
  next['Content-Security-Policy'] = [csp];
  next['X-Content-Type-Options'] = [X_CONTENT_TYPE_OPTIONS];
  return next;
}

/** Returns a Headers copy with Content-Security-Policy and X-Content-Type-Options applied. */
export function withResponseSecurityHeaders(headers: HeadersInit | undefined, csp: string): Headers {
  const merged = new Headers(headers);
  merged.set('Content-Security-Policy', csp);
  merged.set('X-Content-Type-Options', X_CONTENT_TYPE_OPTIONS);
  return merged;
}
