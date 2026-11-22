import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { APP_ORIGIN } from '../src/apppaths.js';
import {
  X_CONTENT_TYPE_OPTIONS,
  applySecurityHeaders,
  buildRendererCsp,
  collectExportScriptHashes,
  extractInlineScriptHashes,
  shouldApplySecurityHeaders,
  withResponseSecurityHeaders,
} from '../src/securityheaders.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

function sha256(text: string): string {
  return `sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}`;
}

afterEach(cleanupTmpDirs);

describe('extractInlineScriptHashes', () => {
  it('hashes non-empty inline scripts and skips external or empty scripts', () => {
    const html = [
      '<script src="/_next/static/chunks/app.js" async=""></script>',
      '<script></script>',
      '<script>(self.__next_f=self.__next_f||[]).push([0])</script>',
      '<script type="text/javascript">self.__next_f.push([1,"ok"])</script>',
      '<script>(self.__next_f=self.__next_f||[]).push([0])</script>',
    ].join('');

    expect(extractInlineScriptHashes(html)).toEqual([
      sha256('(self.__next_f=self.__next_f||[]).push([0])'),
      sha256('self.__next_f.push([1,"ok"])'),
    ].sort());
  });
});

describe('collectExportScriptHashes', () => {
  it('returns an empty list when the export directory does not exist', () => {
    expect(collectExportScriptHashes(path.join(tmpDir(), 'missing'))).toEqual([]);
  });

  it('collects deduplicated hashes across nested HTML files and ignores non-HTML assets', () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<script>console.log(1)</script>');
    fs.writeFileSync(
      path.join(root, 'nested', '404.html'),
      '<script>console.log(2)</script><script>console.log(1)</script>',
    );
    fs.writeFileSync(path.join(root, 'app.js'), '<script>ignored</script>');

    expect(collectExportScriptHashes(root)).toEqual([
      sha256('console.log(1)'),
      sha256('console.log(2)'),
    ].sort());
  });
});

describe('buildRendererCsp', () => {
  it('builds a restrictive production policy using static inline script hashes', () => {
    const hash = sha256('self.__next_f.push([0])');
    const csp = buildRendererCsp({ scriptHashes: [hash] });

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(`script-src 'self' '${hash}'`);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("media-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'none'");
  });

  it('permits dev server HMR and app:// media/tile origins only when devUrl is set', () => {
    const csp = buildRendererCsp({ devUrl: 'http://localhost:3210' });

    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain(`img-src 'self' ${APP_ORIGIN} data: blob:`);
    expect(csp).toContain(`media-src 'self' ${APP_ORIGIN}`);
    expect(csp).toContain(`connect-src 'self' ws://localhost:3210 ${APP_ORIGIN}`);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('shouldApplySecurityHeaders', () => {
  it('matches app://bundle and the configured devUrl origin only', () => {
    expect(shouldApplySecurityHeaders(`${APP_ORIGIN}/index.html`)).toBe(true);
    expect(shouldApplySecurityHeaders(`${APP_ORIGIN}/tiles/topo/1/2/3.png`)).toBe(true);
    expect(shouldApplySecurityHeaders('app://bundle.evil/index.html')).toBe(false);
    expect(shouldApplySecurityHeaders('app://user@bundle/index.html')).toBe(false);
    expect(shouldApplySecurityHeaders('http://localhost:3210/page', 'http://localhost:3210')).toBe(true);
    expect(shouldApplySecurityHeaders('http://localhost:32100/page', 'http://localhost:3210')).toBe(false);
    expect(shouldApplySecurityHeaders('https://example.com/', 'http://localhost:3210')).toBe(false);
    expect(shouldApplySecurityHeaders('not-a-url')).toBe(false);
  });
});

describe('applySecurityHeaders and withResponseSecurityHeaders', () => {
  it('replaces existing CSP/nosniff headers case-insensitively and preserves other headers', () => {
    const csp = buildRendererCsp();
    const updated = applySecurityHeaders(
      {
        'Content-Type': ['text/html; charset=utf-8'],
        'content-security-policy': ["default-src *"],
        'X-Content-Type-Options': ['invalid'],
      },
      csp,
    );

    expect(updated).toEqual({
      'Content-Type': ['text/html; charset=utf-8'],
      'Content-Security-Policy': [csp],
      'X-Content-Type-Options': [X_CONTENT_TYPE_OPTIONS],
    });
  });

  it('sets security headers on fetch Headers instances', () => {
    const csp = buildRendererCsp();
    const headers = withResponseSecurityHeaders({ 'Content-Type': 'video/mp4' }, csp);
    expect(headers.get('content-type')).toBe('video/mp4');
    expect(headers.get('content-security-policy')).toBe(csp);
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });
});
