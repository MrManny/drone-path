import { describe, expect, it } from 'vitest';

import { bundleModuleSource } from '../../src/manual/module.js';
import type { ManualBundle } from '../../src/manual/model.js';

const BUNDLE: ManualBundle = {
  nav: [{ slug: 'index', label: 'Manual' }],
  pages: {
    index: {
      slug: 'index',
      title: 'Manual',
      headings: [{ id: 'manual', text: 'Manual', level: 1 }],
      html: '<h1 id="manual">Manual</h1>\n',
    },
  },
};

describe('bundleModuleSource', () => {
  const source = bundleModuleSource(BUNDLE);

  it('imports the shared types only as types', () => {
    expect(source).toContain(
      "import type { ManualBundle } from '../../../../src/manual/model.js';",
    );
    expect(source).toContain('export const MANUAL: ManualBundle =');
  });

  it('embeds the whole bundle as data', () => {
    expect(source).toContain('"label": "Manual"');
    expect(source).toContain('"title": "Manual"');
    expect(source).toContain('<h1 id=\\"manual\\">');
    expect(source.endsWith('\n')).toBe(true);
  });

  it('is deterministic for the same bundle', () => {
    expect(bundleModuleSource(BUNDLE)).toBe(source);
  });
});
