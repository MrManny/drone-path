import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CompiledPage } from './markdown.js';
import { compileMarkdown } from './markdown.js';
import { bundleModuleSource } from './module.js';
import type { ManualBundle } from './model.js';
import { navFromIndex } from './nav.js';
import { pageSlugOf, sourceNameOf, validateCorpus } from './links.js';

export interface ManualBuildPaths {
  userDir: string;
  imagesDir: string;
  moduleFile: string;
  assetDir: string;
}

export interface ManualBuildResult {
  pages: number;
  images: string[];
}

export function defaultManualPaths(root: string): ManualBuildPaths {
  return {
    userDir: path.join(root, 'docs', 'user'),
    imagesDir: path.join(root, 'docs', 'images'),
    moduleFile: path.join(root, 'ui', 'lib', 'manual', 'generated', 'manual.ts'),
    assetDir: path.join(root, 'ui', 'public', 'manual', 'images'),
  };
}

export function buildManual(paths: ManualBuildPaths): ManualBuildResult {
  const files = fs
    .readdirSync(paths.userDir)
    .filter((file) => file.endsWith('.md'))
    .sort();
  const compiled: CompiledPage[] = files.map((file) => {
    const source = fs.readFileSync(path.join(paths.userDir, file), 'utf8');
    return compileMarkdown(source, pageSlugOf(file));
  });

  const issues: string[] = [];
  for (const { slug, page } of compiled) {
    if (page.title === '') {
      issues.push(`docs/user/${sourceNameOf(slug)} needs a level-1 "# " heading as its title`);
    }
  }
  const index = compiled.find((c) => c.slug === 'index');
  if (!index) issues.push('docs/user/README.md is missing; it is the manual index');

  const imageFiles = new Set(
    fs.existsSync(paths.imagesDir) ? fs.readdirSync(paths.imagesDir) : [],
  );
  for (const issue of validateCorpus(compiled, imageFiles)) {
    issues.push(`${issue.file}: ${issue.message}`);
  }
  if (issues.length > 0) {
    throw new Error(
      `manual corpus has ${issues.length} issue(s):\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
  }

  const bundle: ManualBundle = {
    nav: index ? navFromIndex(index) : [],
    pages: {},
  };
  for (const entry of [...compiled].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    bundle.pages[entry.slug] = entry.page;
  }

  fs.mkdirSync(path.dirname(paths.moduleFile), { recursive: true });
  fs.writeFileSync(paths.moduleFile, bundleModuleSource(bundle));

  const referenced = [
    ...new Set(compiled.flatMap((c) => c.refs.images.map((image) => image.file))),
  ].sort();
  fs.mkdirSync(paths.assetDir, { recursive: true });
  for (const file of referenced) {
    fs.copyFileSync(path.join(paths.imagesDir, file), path.join(paths.assetDir, file));
  }
  return { pages: compiled.length, images: referenced };
}

function main(): void {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const result = buildManual(defaultManualPaths(root));
    process.stderr.write(
      `[drone-path] manual: ${result.pages} page(s), ${result.images.length} image(s)\n`,
    );
  } catch (e) {
    process.stderr.write(`[drone-path] ERROR: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
