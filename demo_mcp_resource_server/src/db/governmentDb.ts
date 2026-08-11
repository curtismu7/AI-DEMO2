'use strict';

/**
 * SQLite backing store for the government vertical.
 *
 * Mirrors the airlines pattern: owns real data instead of proxying to the BFF.
 * Every government tool result is a row read out of this file, so editing
 * the .db out-of-band changes what the demo shows.
 *
 * Path:  GOVERNMENT_DB_PATH  (default <cwd>/data/government.db)
 * Seed:  GOVERNMENT_SEED_PATH (default <pkg>/seed/government.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface Permit {
  id: string;
  permitType: string;
  subject: string;
  jurisdiction: string;
  issuedDate: string;
  expiresDate: string;
  status: string;
  inspector: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS permits (
  id           TEXT PRIMARY KEY,
  permitType   TEXT NOT NULL,
  subject      TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  issuedDate   TEXT NOT NULL,
  expiresDate  TEXT NOT NULL,
  status       TEXT NOT NULL,
  inspector    TEXT NOT NULL
);
`;

function dbPath(): string {
  return process.env.GOVERNMENT_DB_PATH || path.join(process.cwd(), 'data', 'government.db');
}

export function governmentDatabaseName(): string {
  return path.basename(dbPath());
}

function seedPath(): string {
  return process.env.GOVERNMENT_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'government.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM permits').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[government-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insPermit = conn.prepare(
    'INSERT INTO permits (id, permitType, subject, jurisdiction, issuedDate, expiresDate, status, inspector) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const p of seed.permits || []) {
      insPermit.run(p.id, p.permitType, p.subject, p.jurisdiction, p.issuedDate, p.expiresDate, p.status, p.inspector);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[government-db] seeded ${dbPath()} from ${file}`);
}

/**
 * Run `fn` against a freshly opened connection, then close it.
 *
 * Deliberately NOT a cached long-lived handle. Opening per call makes external
 * edits to government.db unconditionally visible on the next tool call,
 * and avoids WAL index drift across Docker bind mounts.
 */
export function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  try {
    conn.exec('PRAGMA foreign_keys = ON');
    conn.exec(SCHEMA);
    seedIfEmpty(conn);
    return fn(conn);
  } finally {
    conn.close();
  }
}

export function listPermits(): Permit[] {
  return withDb((conn) => conn.prepare('SELECT * FROM permits ORDER BY issuedDate DESC').all() as unknown as Permit[]);
}

export function getPermit(id: string): Permit | null {
  const row = withDb((conn) => conn.prepare('SELECT * FROM permits WHERE id = ?').get(id) as Permit | undefined);
  return row ?? null;
}
