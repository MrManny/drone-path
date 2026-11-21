import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, expect, it } from 'vitest';

import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';
import { ARCHIVE_SCHEMA_VERSION, ArchiveStore } from '../src/store.js';

afterEach(cleanupTmpDirs);

it('opens and reads a current archive while another connection holds a write reservation', () => {
  const file = path.join(tmpDir(), 'archive.sqlite');
  new ArchiveStore(file).close();
  const writer = new DatabaseSync(file);
  try {
    writer.exec('BEGIN IMMEDIATE');
    const reader = new ArchiveStore(file);
    try {
      expect(reader.listClips()).toEqual([]);
    } finally {
      reader.close();
    }
  } finally {
    writer.close();
  }
});

it('rejects an unsupported database schema and leaves its version intact', () => {
  const file = path.join(tmpDir(), 'archive.sqlite');
  const newer = ARCHIVE_SCHEMA_VERSION + 1;
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA user_version = ${newer}`);
    expect(() => new ArchiveStore(file)).toThrow(`unsupported archive database schema version: ${newer}`);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(newer);
  } finally {
    db.close();
  }
});

it('does not initialize the archive in an existing database without an archive schema', () => {
  const file = path.join(tmpDir(), 'archive.sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE other_app (value TEXT)');
    expect(() => new ArchiveStore(file)).toThrow('existing database has no archive schema');
    expect(db.prepare('SELECT name FROM sqlite_schema').all().map(({ name }) => name)).toEqual(['other_app']);
  } finally {
    db.close();
  }
});
