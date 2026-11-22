import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const desktop = join(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['.next', 'out', 'generated', 'node_modules']);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function importSpecifiers(filename: string): string[] {
  const tree = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return specifiers;
}

describe('desktop renderer and shared browser-safe boundaries', () => {
  it('forbids ../../src/ and node: imports in apps/desktop/ui/', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(join(desktop, 'ui'))) {
      for (const spec of importSpecifiers(file)) {
        if (spec.startsWith('node:') || /(?:^|\/)\.\.\/src(?:\/|$)/.test(spec)) {
          violations.push(`${file}: ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('forbids node: imports in apps/desktop/shared/', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(join(desktop, 'shared'))) {
      for (const spec of importSpecifiers(file)) {
        if (spec.startsWith('node:')) {
          violations.push(`${file}: ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
