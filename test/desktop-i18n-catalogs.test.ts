import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const catalogDir = 'src/desktop-i18n/catalogs';
const localeFiles = readdirSync(catalogDir).filter((file) => file.endsWith('.json')).sort();

function catalogFor(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(catalogDir, file), 'utf8'));
}

function usedMessages(): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const dir of ['app', 'ui/app', 'ui/components', 'ui/hooks', 'ui/lib', 'ui/icons']) {
    const files = readdirSync(dir).filter((file) => /\.(?:ts|tsx|mjs)$/.test(file));
    for (const file of files) {
      const filename = join(dir, file);
      const tree = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
            ['t', 'tEnglish'].includes(node.expression.text)) {
          const [key, values] = node.arguments;
          if (!key || !ts.isStringLiteral(key)) throw new Error(`use a literal catalog key in ${filename}`);
          if (values && !ts.isObjectLiteralExpression(values)) {
            throw new Error(`use named message values for ${key.text} in ${filename}`);
          }
          const names = values?.properties.map((property) => property.name?.getText(tree) ?? '').sort() ?? [];
          const previous = keys.get(key.text);
          if (previous) expect(names, `${key.text} in ${filename}`).toEqual(previous);
          keys.set(key.text, names);
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  }
  return keys;
}

const used = usedMessages();
const english = catalogFor('en.json');

function checkVariant(value: unknown, keys: string[], key: string) {
  expect(value, key).toEqual(expect.any(String));
  if (typeof value !== 'string') return;
  expect(value.trim(), key).not.toBe('');
  const names = [...new Set(Array.from(value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g), ([, name]) => name))].sort();
  expect(names, key).toEqual(keys);
}

describe('desktop message catalogs', () => {
  it('uses every English key and defines every desktop translation call', () => {
    expect(Object.keys(english).sort()).toEqual([...used.keys()].sort());
  });

  it.each(localeFiles)('%s has a complete catalog with valid message values', (file) => {
    const catalog = catalogFor(file);
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort());
    const pluralCategories = new Intl.PluralRules(file.slice(0, -5)).resolvedOptions().pluralCategories;
    for (const [key, message] of Object.entries(catalog)) {
      const names = used.get(key) ?? [];
      if (typeof english[key] === 'string') {
        checkVariant(message, names, key);
      } else {
        expect(typeof message, key).toBe('object');
        expect(message, key).not.toBeNull();
        if (message === null || typeof message !== 'object') continue;
        expect(message, key).toHaveProperty('other');
        expect(names, key).toContain('count');
        for (const [category, value] of Object.entries(message)) {
          expect(pluralCategories, key).toContain(category);
          checkVariant(value, names, key);
        }
      }
    }
  });
});
